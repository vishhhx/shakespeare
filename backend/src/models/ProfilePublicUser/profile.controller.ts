import type { Request, Response } from "express";
import { Types } from "mongoose";

import {
	UpsertPublicProfileSchema,
	VolunteerApplicationCreateSchema,
	VolunteerApplicationReviewSchema,
} from "../../types/Auth";
import { PublicUserModel } from "../AuthpublicUser/publicUser.model";
import { ProfilePublicUserModel } from "./profile.model";
import { VolunteerApplicationModel } from "./application.model";
import { AuthorityProfileModel } from "../ProfileAdminUser/authority.model";
import redisService from "../../utils/redis";
import s3Service from "../../utils/s3";
import snsService from "../../utils/sns";
import { emitVolunteerApplicationCreated, emitVolunteerApplicationReviewed } from "../../handlers/socketHandlers";
import { getGlobalIO } from "../../utils/socketManager";

const AUTHORITY_GEO_KEY = "authorities";

const getPreferredAuthorityType = (preferredRoles: string[]): "hospital" | "fire" | "police" => {
	if (preferredRoles.includes("medical")) {
		return "hospital";
	}
	if (preferredRoles.includes("rescue")) {
		return "fire";
	}
	return "police";
};

const toSignedReadUrl = async (keyOrUrl: string): Promise<string> => {
	if (/^https?:\/\//i.test(keyOrUrl)) {
		return keyOrUrl;
	}
	return s3Service.signReadUrl(keyOrUrl);
};

export const upsertPublicUserProfile = async (req: Request, res: Response) => {
	try {
		const parsed = UpsertPublicProfileSchema.safeParse(req.body);
		if (!parsed.success) {
			return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(",") });
		}

		const userId = req.authUser?.userId;
		if (!userId || !Types.ObjectId.isValid(userId)) {
			return res.status(401).json({ error: "Authentication required" });
		}

		const publicUser = await PublicUserModel.findById(userId);
		if (!publicUser) {
			return res.status(404).json({ error: "User not found" });
		}

		const data = parsed.data;
		const updateData: any = {
			userId: publicUser._id,
			name: data.name,
			phoneNumber: publicUser.phoneNumber,
			profileImage: data.profileImage,
			contacts: data.contacts,
			appContacts: data.appContacts.map((id) => new Types.ObjectId(id)),
			medicalRecord: data.medicalRecord,
			sosMessage: data.sosMessage,
			autoShareMedical: data.autoShareMedical,
			enableContinuousTracking: data.enableContinuousTracking ?? false,
		};

		// Add location if provided
		if (data.location && data.location.lat && data.location.lng) {
			updateData.location = data.location;
			updateData.lastLocationUpdate = new Date();
		}

		const profile = await ProfilePublicUserModel.findOneAndUpdate(
			{ userId: publicUser._id },
			updateData,
			{ new: true, upsert: true, setDefaultsOnInsert: true },
		);

		// Store location in Redis if provided
		if (data.location && data.location.lat && data.location.lng) {
			try {
				await redisService.addLocation(
					"public-users",
					String(publicUser._id),
					data.location.lng,
					data.location.lat
				);
				console.log(`Location stored in Redis for user ${publicUser._id}`);
			} catch (err) {
				console.warn("Error storing location in Redis:", err);
			}
		}

		publicUser.name = data.name;
		if (data.profileImage) {
			publicUser.avatarUrl = data.profileImage;
		}
		publicUser.isprofileComplete = true;
		await publicUser.save();

		return res.status(200).json({
			message: "Profile saved successfully",
			profile,
			user: {
				_id: String(publicUser._id),
				userId: String(publicUser._id),
				phoneNumber: publicUser.phoneNumber,
				name: publicUser.name ?? "",
				role: publicUser.role,
				isVerified: publicUser.isVerified,
				avatarUrl: publicUser.avatarUrl ?? "",
				isprofileComplete: publicUser.isprofileComplete,
			},
		});
	} catch (error) {
		console.error("Error saving public profile:", error);
		return res.status(500).json({ error: "Failed to save profile" });
	}
};

export const getPublicUserProfile = async (req: Request, res: Response) => {
	try {
		const userId = req.authUser?.userId;
		if (!userId || !Types.ObjectId.isValid(userId)) {
			return res.status(401).json({ error: "Authentication required" });
		}

		const profile = await ProfilePublicUserModel.findOne({ userId }).lean();
		if (!profile) {
			return res.status(404).json({ error: "Profile not found" });
		}

		return res.status(200).json({ profile });
	} catch (error) {
		console.error("Error fetching public profile:", error);
		return res.status(500).json({ error: "Failed to fetch profile" });
	}
};

export const createVolunteerApplication = async (req: Request, res: Response) => {
	try {
		const parsed = VolunteerApplicationCreateSchema.safeParse(req.body);
		if (!parsed.success) {
			return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(",") });
		}

		const userId = req.authUser?.userId;
		if (!userId || !Types.ObjectId.isValid(userId)) {
			return res.status(401).json({ error: "Authentication required" });
		}

		const publicUser = await PublicUserModel.findById(userId);
		if (!publicUser) {
			return res.status(404).json({ error: "User not found" });
		}

		if (publicUser.role === "volunteer") {
			return res.status(400).json({ error: "User is already a volunteer" });
		}

		const existingApplication = await VolunteerApplicationModel.findOne({
			userId: publicUser._id,
			status: { $in: ["pending", "approved"] },
		}).lean();

		if (existingApplication) {
			return res.status(400).json({ error: "You already have an active volunteer application" });
		}

		const data = parsed.data;
		const authorityType = getPreferredAuthorityType(data.preferredRoles);

		const nearbyAuthorities = await redisService.getNearbyLocations(
			AUTHORITY_GEO_KEY,
			data.location.lng,
			data.location.lat,
			10,
			"km",
		);

		if (nearbyAuthorities.length === 0) {
			return res.status(404).json({ error: "No nearby authorities found for assignment" });
		}

		const nearbyAuthorityIds = nearbyAuthorities
			.map((entry) => entry.member)
			.filter((memberId) => Types.ObjectId.isValid(memberId));

		const authorityProfiles = await AuthorityProfileModel.find({
			_id: { $in: nearbyAuthorityIds },
			authorityType,
			verificationStatus: "verified",
			isActive: true,
		})
			.select("_id userId authorityType")
			.lean();

		if (authorityProfiles.length === 0) {
			return res.status(404).json({ error: "No matching verified authority available nearby" });
		}

		const authorityById = new Map(authorityProfiles.map((profile) => [String(profile._id), profile]));
		const selectedAuthority = nearbyAuthorityIds
			.map((id) => authorityById.get(id))
			.find((profile) => !!profile);

		if (!selectedAuthority) {
			return res.status(404).json({ error: "Unable to assign authority at this time" });
		}

		const application = await VolunteerApplicationModel.create({
			userId: publicUser._id,
			skills: data.skills,
			experience: data.experience,
			documents: data.documents,
			preferredRoles: data.preferredRoles,
			availability: data.availability,
			status: "pending",
			assignedAuthority: selectedAuthority._id,
			assignedAuthorityType: selectedAuthority.authorityType,
		});

		// Emit socket event to authority
		try {
			const io = getGlobalIO();
			if (io) {
				emitVolunteerApplicationCreated(io, String(selectedAuthority._id), application);
				console.log(`Socket event sent to authority ${selectedAuthority._id}`);
			}
		} catch (err) {
			console.error("Error emitting socket event:", err);
		}

		// Send SMS notification to user (optional if online check is available)
		try {
			if (publicUser.phoneNumber) {
				await snsService.sendSMS(
					publicUser.phoneNumber,
					`Hi ${publicUser.name}, your volunteer application has been received and assigned to an authority. Status: Pending Review.`
				);
			}
		} catch (err) {
			console.warn("Error sending SMS notification:", err);
		}

		return res.status(201).json({
			message: "Volunteer application submitted successfully",
			application,
			assignedAuthority: {
				authorityProfileId: selectedAuthority._id,
				authorityUserId: selectedAuthority.userId,
				authorityType: selectedAuthority.authorityType,
			},
		});
	} catch (error) {
		console.error("Error creating volunteer application:", error);
		return res.status(500).json({ error: "Failed to submit volunteer application" });
	}
};

export const getMyVolunteerApplication = async (req: Request, res: Response) => {
	try {
		const userId = req.authUser?.userId;
		if (!userId || !Types.ObjectId.isValid(userId)) {
			return res.status(401).json({ error: "Authentication required" });
		}

		const application = await VolunteerApplicationModel.findOne({ userId })
			.sort({ createdAt: -1 })
			.lean();

		if (!application) {
			return res.status(404).json({ error: "No volunteer application found" });
		}

		const documents = await Promise.all(
			(application.documents ?? []).map(async (document) => ({
				...document,
				signedUrl:
					typeof document.url === "string" && document.url.length > 0
						? await toSignedReadUrl(document.url)
						: null,
			})),
		);

		return res.status(200).json({
			application: {
				...application,
				documents,
			},
		});
	} catch (error) {
		console.error("Error fetching volunteer application:", error);
		return res.status(500).json({ error: "Failed to fetch volunteer application" });
	}
};

export const getAssignedVolunteerApplications = async (req: Request, res: Response) => {
	try {
		const authorityUserId = req.authUser?.userId;
		if (!authorityUserId || !Types.ObjectId.isValid(authorityUserId)) {
			return res.status(401).json({ error: "Authentication required" });
		}

		const authorityProfile = await AuthorityProfileModel.findOne({ userId: authorityUserId })
			.select("_id authorityType")
			.lean();

		if (!authorityProfile) {
			return res.status(404).json({ error: "Authority profile not found" });
		}

		const applications = await VolunteerApplicationModel.find({ assignedAuthority: authorityProfile._id })
			.sort({ createdAt: -1 })
			.lean();

		const payload = await Promise.all(
			applications.map(async (application) => ({
				...application,
				documents: await Promise.all(
					(application.documents ?? []).map(async (document) => ({
						...document,
						signedUrl:
							typeof document.url === "string" && document.url.length > 0
								? await toSignedReadUrl(document.url)
								: null,
					})),
				),
			})),
		);

		return res.status(200).json({ applications: payload });
	} catch (error) {
		console.error("Error fetching assigned volunteer applications:", error);
		return res.status(500).json({ error: "Failed to fetch assigned applications" });
	}
};

export const reviewVolunteerApplication = async (req: Request, res: Response) => {
	try {
		const parsed = VolunteerApplicationReviewSchema.safeParse(req.body);
		if (!parsed.success) {
			return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(",") });
		}

		const authorityUserId = req.authUser?.userId;
		if (!authorityUserId || !Types.ObjectId.isValid(authorityUserId)) {
			return res.status(401).json({ error: "Authentication required" });
		}

		const rawApplicationId = req.params.applicationId;
		const applicationId = Array.isArray(rawApplicationId) ? rawApplicationId[0] : rawApplicationId;
		if (!applicationId || !Types.ObjectId.isValid(applicationId)) {
			return res.status(400).json({ error: "Invalid application id" });
		}

		const authorityProfile = await AuthorityProfileModel.findOne({ userId: authorityUserId })
			.select("_id")
			.lean();

		if (!authorityProfile) {
			return res.status(404).json({ error: "Authority profile not found" });
		}

		const application = await VolunteerApplicationModel.findOne({
			_id: applicationId,
			assignedAuthority: authorityProfile._id,
		});

		if (!application) {
			return res.status(404).json({ error: "Application not found for this authority" });
		}

		if (application.status !== "pending") {
			return res.status(400).json({ error: "Only pending applications can be reviewed" });
		}

		application.status = parsed.data.status;
		application.reviewedBy = new Types.ObjectId(authorityUserId);
		application.reviewNotes = parsed.data.reviewNotes;
		await application.save();

		let publicUser = null;
		if (parsed.data.status === "approved") {
			publicUser = await PublicUserModel.findById(application.userId);
			if (publicUser) {
				publicUser.role = "volunteer";
				await publicUser.save();
			}
		}

		// Emit socket event to user
		try {
			const io = getGlobalIO();
			if (io && publicUser) {
				emitVolunteerApplicationReviewed(
					io,
					String(application.userId),
					parsed.data.status,
					"SafeSphere Authority"
				);
				console.log(`Socket event sent to user ${application.userId} - Status: ${parsed.data.status}`);
			}
		} catch (err) {
			console.error("Error emitting socket event:", err);
		}

		// Send SMS notification to user
		try {
			if (publicUser?.phoneNumber) {
				let smsMessage = "";
				if (parsed.data.status === "approved") {
					smsMessage = `Hi ${publicUser.name}, great news! Your volunteer application has been APPROVED. You are now a volunteer on SafeSphere.`;
				} else {
					smsMessage = `Hi ${publicUser.name}, we regret to inform you that your volunteer application has been REJECTED. ${parsed.data.reviewNotes ? 'Feedback: ' + parsed.data.reviewNotes : ''}`;
				}
				
				await snsService.sendSMS(publicUser.phoneNumber, smsMessage);
				console.log(`SMS sent to user ${publicUser.phoneNumber}`);
			}
		} catch (err) {
			console.warn("Error sending SMS notification:", err);
		}

		return res.status(200).json({
			message: `Application ${parsed.data.status} successfully`,
			application,
		});
	} catch (error) {
		console.error("Error reviewing volunteer application:", error);
		return res.status(500).json({ error: "Failed to review volunteer application" });
	}
};
