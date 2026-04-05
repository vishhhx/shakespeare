export const normalizeIndianPhoneNumber = (input: string): string => {
  const digits = input.replace(/\D/g, "");

  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) {
    return `+91${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("0")) {
    const local = digits.slice(1);
    if (/^[6-9]\d{9}$/.test(local)) {
      return `+91${local}`;
    }
  }

  if (digits.length === 12 && digits.startsWith("91")) {
    const local = digits.slice(2);
    if (/^[6-9]\d{9}$/.test(local)) {
      return `+91${local}`;
    }
  }

  return "";
};