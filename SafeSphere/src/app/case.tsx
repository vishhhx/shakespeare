import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Linking, Platform, Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Animated, { FadeIn, useReducedMotion } from "react-native-reanimated";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Flag,
  LogOut,
  MapPinned,
  Navigation,
  Phone,
  RefreshCw,
  ShieldCheck,
} from "lucide-react-native";

import { useSocketEvent } from "../context/socketContext";
import { useActiveCase } from "../context/activeCase";
import { useCurrentLocation } from "../hooks/useCurrentLocation";
import { useDirections } from "../hooks/useDirections";
import {
  acceptEmergencyResponse,
  flagEmergencyAsFake,
  getApiErrorMessage,
  getEmergencyById,
  leaveEmergencyCase,
  updateMyResponderStatus,
} from "../lib/api";
import {
  EMERGENCY_TYPE_LABELS,
  RESPONDER_STATUS_LABELS,
  ROLE_LABELS,
  STATUS_LABELS,
  type CaseDetails,
  type CaseLocationEvent,
  type CaseUpdatedEvent,
  type EmergencyStatus,
  type ResponderStatus,
} from "../lib/emergencyTypes";
import { radius, space, useTheme } from "../theme";
import { AppText, Banner, Button, Card, Screen } from "../components/ui";
import { RoleTag, SeverityBadge, StatusPill, statusTone } from "../components/emergency/badges";
import { CaseMap, ageText } from "../components/emergency/CaseMap";
import { CaseCallCard } from "../components/call/CaseCallCard";
import EmergencyChatbotWidget from "../components/emergency-chatbot-widget";

const LIFECYCLE: EmergencyStatus[] = ["reported", "verified", "in_progress", "resolved", "closed"];
const NEXT_STATUS: Partial<Record<ResponderStatus, Exclude<ResponderStatus, "assigned">>> = {
  assigned: "enroute",
  enroute: "on_scene",
  on_scene: "completed",
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: CaseDetails }
  | { kind: "forbidden"; message: string }
  | { kind: "error"; message: string };

export default function CaseScreen() {
  const params = useLocalSearchParams<{ emergencyId?: string; autoJoin?: string; justSent?: string }>();
  const emergencyId = String(params.emergencyId || "");
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const { refresh: refreshActiveCase } = useActiveCase();

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const versionRef = useRef(0);

  const data = state.kind === "ready" ? state.data : null;
  const viewer = data?.viewer;
  const isActive = data ? ["reported", "verified", "in_progress"].includes(data.status) : false;
  // Responders navigate; reporters and viewers just watch. Location is watched while relevant.
  const isNavigating = Boolean(viewer?.isResponder && !viewer.isReporter && isActive);
  const myLocation = useCurrentLocation({ watch: isNavigating });

  const load = useCallback(async () => {
    if (!emergencyId) {
      setState({ kind: "error", message: "No emergency selected." });
      return;
    }
    try {
      const response = await getEmergencyById(emergencyId, myLocation.coords);
      // Ignore a response older than what's on screen (responses can arrive out of order).
      if (response.emergency.version < versionRef.current) return;
      versionRef.current = response.emergency.version;
      setState({ kind: "ready", data: response.emergency });
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 403 || status === 404) {
        setState({
          kind: "forbidden",
          message: status === 404 ? "This emergency no longer exists." : "You don't have access to this emergency.",
        });
        return;
      }
      setState((previous) => (previous.kind === "ready" ? previous : { kind: "error", message: getApiErrorMessage(error) }));
    }
  }, [emergencyId, myLocation.coords?.lat, myLocation.coords?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void load();
  }, [emergencyId]); // eslint-disable-line react-hooks/exhaustive-deps

  // A nearby helper's preview depends on their position; reload once we have one.
  useEffect(() => {
    if (data?.preview && myLocation.coords) void load();
  }, [Boolean(myLocation.coords)]); // eslint-disable-line react-hooks/exhaustive-deps

  useSocketEvent("emergency-case-updated", (event: CaseUpdatedEvent) => {
    if (event?.emergencyId === emergencyId && event.version > versionRef.current) void load();
  });
  useSocketEvent("emergency-case-closed", (event: { emergencyId?: string }) => {
    if (event?.emergencyId === emergencyId) void load();
  });
  useSocketEvent("connect", () => void load());
  useSocketEvent("emergency-location-update", (event: CaseLocationEvent) => {
    if (event?.emergencyId !== emergencyId) return;
    setState((previous) => {
      if (previous.kind !== "ready") return previous;
      const current = previous.data;
      const at = new Date(event.recordedAt).getTime();
      if (event.party === "reporter" && current.reporter) {
        const known = current.reporter.liveLocation?.updatedAt;
        if (known && new Date(known).getTime() >= at) return previous;
        return { kind: "ready", data: { ...current, reporter: { ...current.reporter, liveLocation: { lat: event.lat, lng: event.lng, updatedAt: event.recordedAt } } } };
      }
      const responders = (current.responders ?? []).map((responder) => {
        if (responder.userId !== event.userId) return responder;
        // Out-of-order delivery must never move a marker back in time.
        if (responder.locationUpdatedAt && new Date(responder.locationUpdatedAt).getTime() >= at) return responder;
        return { ...responder, location: { lat: event.lat, lng: event.lng }, locationUpdatedAt: event.recordedAt };
      });
      return { kind: "ready", data: { ...current, responders } };
    });
  });

  const incident = data?.incident ?? null;
  const directions = useDirections(myLocation.coords, incident, isNavigating);

  const act = async (key: string, run: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    try {
      await run();
      if (success) Alert.alert(success);
      await load();
      void refreshActiveCase();
    } catch (error) {
      Alert.alert("That didn't work", getApiErrorMessage(error));
      void load();
    } finally {
      setBusy(null);
    }
  };

  const call = (phone?: string) => phone && void Linking.openURL(`tel:${phone}`).catch(() => Alert.alert("Can't place calls", phone));

  const openExternalNavigation = () => {
    if (!incident) return;
    const destination = `${incident.lat},${incident.lng}`;
    const url =
      Platform.OS === "ios"
        ? `http://maps.apple.com/?daddr=${destination}&dirflg=d`
        : `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`;
    void Linking.openURL(url);
  };

  const confirmLeave = () =>
    Alert.alert("Leave this emergency?", "The reporter and other responders will be told you've left.", [
      { text: "Stay", style: "cancel" },
      { text: "Leave", style: "destructive", onPress: () => void act("leave", () => leaveEmergencyCase(emergencyId)) },
    ]);

  const confirmFlag = () =>
    Alert.alert(
      "Report as fake?",
      `Only do this if you're sure there is no real emergency. When ${data?.fakeReports?.threshold ?? 3} people on the case report it, the case closes and the reporter is permanently blocked.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Report as fake",
          style: "destructive",
          onPress: () => void act("flag", () => flagEmergencyAsFake(emergencyId), "Thanks. Your report was recorded."),
        },
      ],
    );

  const me = data?.responders?.find((responder) => responder.isMe);
  const subjectLabel = useMemo(() => {
    if (!data?.subject) return "Person needing help";
    if (data.subject.isReporter) return `${data.subject.name ?? "The reporter"} (the reporter)`;
    return data.subject.name ?? data.subject.label ?? "Person needing help";
  }, [data?.subject]);

  if (state.kind === "loading") {
    return (
      <Screen header={<BackHeader />}>
        <View style={styles.stack}>
          {[120, 300, 160].map((height) => (
            <View key={height} style={[styles.skeleton, { height, backgroundColor: colors.surfaceMuted }]} accessibilityLabel="Loading" />
          ))}
        </View>
      </Screen>
    );
  }

  if (state.kind === "forbidden" || state.kind === "error") {
    return (
      <Screen header={<BackHeader />}>
        <View style={styles.stack}>
          <Banner tone={state.kind === "error" ? "danger" : "info"} message={state.message} />
          {state.kind === "error" && <Button label="Try again" icon={RefreshCw} variant="secondary" onPress={() => { setState({ kind: "loading" }); void load(); }} />}
          <Button label="Back to emergency" variant="secondary" onPress={() => router.replace("/(tabs)/emergency")} />
        </View>
      </Screen>
    );
  }

  const caseData = state.data;
  const permissions = caseData.viewer.permissions;
  const tone = statusTone(colors, caseData.status);

  return (
    <Screen header={<BackHeader />}>
      <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(200)} style={styles.stack}>
        {params.justSent === "1" && isActive && (
          <Banner tone="success" title="SOS sent" message="People nearby, local authorities and the control center are being alerted, and the control center is being called. Your emergency contacts get an SMS." />
        )}
        {params.justSent === "0" && isActive && caseData.viewer.isReporter && (
          <Banner tone="info" message="You already had an open emergency, so we opened it instead of sending a new one." />
        )}

        <View style={[styles.hero, { backgroundColor: tone.bg }]}>
          <View style={styles.rowBetween}>
            <StatusPill status={caseData.status} />
            <AppText variant="caption" tone="muted">Case #{caseData.emergencyId.slice(-6).toUpperCase()}</AppText>
          </View>
          <AppText variant="title">{caseData.title}</AppText>
          <View style={styles.row}>
            <SeverityBadge severity={caseData.severity} />
            <AppText variant="caption" tone="muted">
              {EMERGENCY_TYPE_LABELS[caseData.type]} · reported {ageText(caseData.createdAt)}
            </AppText>
          </View>
          <Lifecycle status={caseData.status} />
        </View>

        {caseData.isFake && <Banner tone="danger" message="This case was closed after being reported as fake." />}

        {!caseData.preview && <CaseCallCard emergencyId={emergencyId} isReporter={caseData.viewer.isReporter} caseOpen={isActive} />}

        {caseData.preview ? (
          <Card>
            <AppText variant="overline" tone="muted">SOMEONE NEARBY NEEDS HELP</AppText>
            {!!caseData.description && <AppText variant="body">{caseData.description}</AppText>}
            <AppText variant="caption" tone="muted">
              {caseData.subject?.label}
              {caseData.subject?.condition ? ` · ${caseData.subject.condition}` : ""}
              {caseData.distanceFromRequesterKm != null ? ` · ${caseData.distanceFromRequesterKm.toFixed(1)} km from you` : ""}
            </AppText>
            <AppText variant="caption" tone="muted">
              {caseData.respondersConnected} {caseData.respondersConnected === 1 ? "person is" : "people are"} already helping. Names and contact
              details are shared once you join.
            </AppText>
            {permissions.canAccept ? (
              <Button
                label="I can help"
                loading={busy === "accept"}
                onPress={() => void act("accept", () => acceptEmergencyResponse(emergencyId, myLocation.coords))}
              />
            ) : (
              <AppText variant="caption" tone="muted">Share your location so we can confirm you’re close enough to help.</AppText>
            )}
          </Card>
        ) : (
          <>
            {isNavigating && me && (
              <Card>
                <AppText variant="overline" tone="muted">YOUR RESPONSE</AppText>
                <View style={styles.rowBetween}>
                  <AppText variant="headline">{RESPONDER_STATUS_LABELS[me.status]}</AppText>
                  {directions.status === "ready" && (
                    <AppText variant="bodyStrong" tone="accent">
                      {directions.durationText} · {directions.distanceText}
                    </AppText>
                  )}
                </View>
                {directions.status === "error" && <AppText variant="caption" tone="danger">{directions.message}</AppText>}
                {directions.status === "loading" && <AppText variant="caption" tone="muted">Working out the fastest route…</AppText>}
                {myLocation.status === "denied" && (
                  <Banner tone="danger" message="Turn on location so we can route you and show the reporter you're coming." actionLabel="Open settings" onAction={myLocation.openSettings} />
                )}
                <View style={styles.row}>
                  {NEXT_STATUS[me.status] && (
                    <View style={styles.flex}>
                      <Button
                        label={NEXT_STATUS[me.status] === "enroute" ? "I'm on my way" : NEXT_STATUS[me.status] === "on_scene" ? "I've arrived" : "I'm done"}
                        icon={NEXT_STATUS[me.status] === "completed" ? CheckCircle2 : Navigation}
                        loading={busy === "status"}
                        onPress={() => void act("status", () => updateMyResponderStatus(emergencyId, NEXT_STATUS[me.status]!))}
                      />
                    </View>
                  )}
                  <View style={styles.flex}>
                    <Button label="Open in Maps" icon={MapPinned} variant="secondary" onPress={openExternalNavigation} />
                  </View>
                </View>
              </Card>
            )}

            {incident && (
              <Card>
                <View style={styles.rowBetween}>
                  <AppText variant="bodyStrong">Map</AppText>
                  {isNavigating && directions.status === "ready" && (
                    <AppText variant="caption" tone="muted">Route updated {ageText(new Date(directions.fetchedAt).toISOString())}</AppText>
                  )}
                </View>
                <CaseMap
                  incident={incident}
                  subjectLabel={subjectLabel}
                  reporter={caseData.reporter ? { name: caseData.reporter.name, liveLocation: caseData.reporter.liveLocation, isViewer: caseData.viewer.isReporter } : undefined}
                  responders={caseData.responders ?? []}
                  authority={caseData.responsibleAuthority}
                  route={directions.status === "ready" ? directions.path : undefined}
                  showMyLocation={myLocation.status === "ready"}
                />
              </Card>
            )}

            <Card>
              <AppText variant="bodyStrong">Who’s involved</AppText>
              <PersonRow
                overline="REPORTED BY"
                name={caseData.viewer.isReporter ? "You" : caseData.reporter?.name ?? "SafeSphere user"}
                detail={caseData.relationToVictim && caseData.relationToVictim !== "self" ? `Reporting for someone else (${caseData.relationToVictim})` : "Reporting for themselves"}
                phone={caseData.reporter?.phoneNumber}
                onCall={call}
              />
              <PersonRow
                overline="NEEDS HELP"
                name={caseData.subject?.isReporter ? (caseData.viewer.isReporter ? "You" : caseData.subject?.name ?? "The reporter") : caseData.subject?.name ?? "Unknown person"}
                detail={[
                  caseData.subject?.isReporter
                    ? "Same person as the reporter"
                    : caseData.subject?.identification === "identified"
                      ? `Identified by face match the reporter confirmed${typeof caseData.subject.matchConfidence === "number" ? ` (${Math.round(caseData.subject.matchConfidence * 100)}% similar)` : ""}`
                      : "Not identified",
                  caseData.subject?.condition,
                  caseData.victimsCount && caseData.victimsCount > 1 ? `${caseData.victimsCount} people affected` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <AppText variant="overline" tone="muted">RESPONSIBLE AUTHORITY</AppText>
              {caseData.responsibleAuthority ? (
                <View style={styles.row}>
                  <Building2 size={18} color={colors.text} aria-hidden />
                  <AppText variant="bodyStrong" style={styles.flex}>{caseData.responsibleAuthority.name}</AppText>
                  {!!caseData.responsibleAuthority.contactNumber && (
                    <Button label="Call" icon={Phone} variant="secondary" fullWidth={false} onPress={() => call(caseData.responsibleAuthority?.contactNumber)} />
                  )}
                </View>
              ) : (
                <AppText variant="caption" tone="muted">No authority has taken this case yet. Nearby authorities have been alerted.</AppText>
              )}
              {caseData.monitoredByControlCenter && (
                <View style={styles.row}>
                  <ShieldCheck size={16} color={colors.textMuted} aria-hidden />
                  <AppText variant="caption" tone="muted">Monitored by the SafeSphere control center</AppText>
                </View>
              )}
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <AppText variant="overline" tone="muted">RESPONDING ({caseData.responders?.length ?? 0})</AppText>
              {(caseData.responders ?? []).length === 0 ? (
                <AppText variant="caption" tone="muted">Nobody has accepted yet. You’ll be notified the moment someone does.</AppText>
              ) : (
                (caseData.responders ?? []).map((responder) => (
                  <View key={responder.userId} style={styles.responder}>
                    <View style={styles.flex}>
                      <View style={styles.row}>
                        <AppText variant="bodyStrong">{responder.isMe ? "You" : responder.name}</AppText>
                        <RoleTag role={responder.actorRole} />
                      </View>
                      <AppText variant="caption" tone="muted">
                        {[
                          responder.organization?.name,
                          RESPONDER_STATUS_LABELS[responder.status],
                          responder.assignedByRole ? `assigned by ${ROLE_LABELS[responder.assignedByRole].toLowerCase()}` : null,
                          responder.location ? `position ${ageText(responder.locationUpdatedAt)}` : "position not shared",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </AppText>
                    </View>
                    {!responder.isMe && !!responder.phoneNumber && (
                      <Button label="Call" icon={Phone} variant="secondary" fullWidth={false} onPress={() => call(responder.phoneNumber)} />
                    )}
                  </View>
                ))
              )}
            </Card>

            {permissions.canViewMedical && (caseData.subject?.medicalRecord || caseData.subject?.sosMessage) && (
              <Card>
                <AppText variant="bodyStrong">Medical information</AppText>
                <AppText variant="caption" tone="muted">Shared with people responding to this case.</AppText>
                {caseData.subject?.medicalRecord?.bloodGroup && <Fact label="Blood group" value={caseData.subject.medicalRecord.bloodGroup} />}
                {!!caseData.subject?.medicalRecord?.allergies?.length && <Fact label="Allergies" value={caseData.subject.medicalRecord.allergies.join(", ")} />}
                {!!caseData.subject?.medicalRecord?.medications?.length && <Fact label="Medications" value={caseData.subject.medicalRecord.medications.join(", ")} />}
                {!!caseData.subject?.medicalRecord?.diseases?.length && <Fact label="Conditions" value={caseData.subject.medicalRecord.diseases.join(", ")} />}
                {!!caseData.subject?.medicalRecord?.notes && <Fact label="Notes" value={caseData.subject.medicalRecord.notes} />}
                {!!caseData.subject?.sosMessage && <Fact label="Their SOS message" value={caseData.subject.sosMessage} />}
              </Card>
            )}

            {permissions.canViewContacts && !!caseData.subject?.contacts?.length && !caseData.viewer.isReporter && (
              <Card>
                <AppText variant="bodyStrong">Their emergency contacts</AppText>
                {caseData.subject.contacts.map((contact) => (
                  <View key={contact.phoneNumber} style={styles.rowBetween}>
                    <View style={styles.flex}>
                      <AppText variant="body">{contact.name}</AppText>
                      {!!contact.relation && <AppText variant="caption" tone="muted">{contact.relation}</AppText>}
                    </View>
                    <Button label="Call" icon={Phone} variant="secondary" fullWidth={false} onPress={() => call(contact.phoneNumber)} />
                  </View>
                ))}
              </Card>
            )}

            <Card>
              <AppText variant="bodyStrong">Actions</AppText>
              {caseData.viewer.isReporter && <Button label="Call 112" icon={Phone} variant="secondary" onPress={() => call("112")} />}
              {permissions.canAccept && (
                <Button label="I can help" loading={busy === "accept"} onPress={() => void act("accept", () => acceptEmergencyResponse(emergencyId, myLocation.coords))} />
              )}
              {permissions.canLeave && <Button label="Leave this case" icon={LogOut} variant="ghost" loading={busy === "leave"} onPress={confirmLeave} />}
              {permissions.canFlagFake && <Button label="Report as fake" icon={Flag} variant="ghost" loading={busy === "flag"} onPress={confirmFlag} />}
              {caseData.viewer.hasFlagged && <AppText variant="caption" tone="muted">You reported this case as fake.</AppText>}
              {!isActive && (
                <AppText variant="caption" tone="muted">
                  This case is {STATUS_LABELS[caseData.status].toLowerCase()}. Actions are no longer available.
                </AppText>
              )}
            </Card>

            {!!caseData.timeline?.length && (
              <Card>
                <AppText variant="bodyStrong">Timeline</AppText>
                {[...caseData.timeline].reverse().slice(0, 15).map((entry, index) => (
                  <View key={`${entry.timestamp}-${index}`} style={styles.timelineRow}>
                    <View style={[styles.timelineDot, { backgroundColor: index === 0 ? colors.accent : colors.borderStrong }]} />
                    <View style={styles.flex}>
                      <AppText variant="body">{entry.event}</AppText>
                      <AppText variant="caption" tone="muted">
                        {[entry.actorName, new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })].filter(Boolean).join(" · ")}
                      </AppText>
                    </View>
                  </View>
                ))}
              </Card>
            )}
          </>
        )}
      </Animated.View>

      {!caseData.preview && <EmergencyChatbotWidget emergencyId={emergencyId} side="right" bottomOffset={24} horizontalOffset={18} />}
    </Screen>
  );
}

function BackHeader() {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/emergency"))}
      style={styles.back}
      hitSlop={8}
    >
      <ArrowLeft size={22} color={colors.text} />
      <AppText variant="label">Back</AppText>
    </Pressable>
  );
}

function Lifecycle({ status }: { status: EmergencyStatus }) {
  const { colors } = useTheme();
  const current = LIFECYCLE.indexOf(status);
  return (
    <View style={styles.lifecycle} accessible accessibilityLabel={`Progress: ${STATUS_LABELS[status]}, step ${current + 1} of ${LIFECYCLE.length}`}>
      {LIFECYCLE.map((step, index) => (
        <View key={step} style={styles.flex}>
          <View style={[styles.step, { backgroundColor: index <= current ? colors.text : colors.border }]} />
          <AppText variant="caption" tone={index === current ? "default" : "subtle"} numberOfLines={1}>
            {STATUS_LABELS[step]}
          </AppText>
        </View>
      ))}
    </View>
  );
}

function PersonRow({ overline, name, detail, phone, onCall }: { overline: string; name: string; detail?: string; phone?: string; onCall?: (phone?: string) => void }) {
  return (
    <View style={styles.rowBetween}>
      <View style={styles.flex}>
        <AppText variant="overline" tone="muted">{overline}</AppText>
        <AppText variant="bodyStrong">{name}</AppText>
        {!!detail && <AppText variant="caption" tone="muted">{detail}</AppText>}
      </View>
      {!!phone && onCall && <Button label="Call" icon={Phone} variant="secondary" fullWidth={false} onPress={() => onCall(phone)} />}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <AppText variant="label" tone="muted">{label}</AppText>
      <AppText variant="body">{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  row: { flexDirection: "row", alignItems: "center", gap: space.xs, flexWrap: "wrap" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  flex: { flex: 1 },
  back: { flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: 44 },
  hero: { borderRadius: radius.xl, padding: space.lg, gap: space.sm },
  lifecycle: { flexDirection: "row", gap: 4, marginTop: space.xs },
  step: { height: 4, borderRadius: 2, marginBottom: 4 },
  skeleton: { borderRadius: radius.lg },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: space.xs },
  responder: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.xs },
  fact: { gap: 2 },
  timelineRow: { flexDirection: "row", gap: space.sm, alignItems: "flex-start" },
  timelineDot: { width: 8, height: 8, borderRadius: 4, marginTop: 8 },
});
