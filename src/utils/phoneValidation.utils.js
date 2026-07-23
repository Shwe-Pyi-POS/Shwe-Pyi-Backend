import pkg from "google-libphonenumber";
const { PhoneNumberUtil, PhoneNumberFormat } = pkg;

const phoneUtil = PhoneNumberUtil.getInstance();

/**
 * Validates a phone number using google-libphonenumber
 * @param {string} phoneNumber - The phone number to validate
 * @param {string} defaultRegion - Default region code (e.g., 'MM' for Myanmar, 'US' for United States)
 * @returns {Object} - { isValid: boolean, formattedNumber: string|null, error: string|null }
 */
export const validatePhoneNumber = (phoneNumber, defaultRegion = "MM") => {
  try {
    if (!phoneNumber || typeof phoneNumber !== "string") {
      return {
        isValid: false,
        formattedNumber: null,
        error: "Phone number is required and must be a string",
      };
    }

    // Trim whitespace
    const trimmedPhone = phoneNumber.trim();

    if (!trimmedPhone) {
      return {
        isValid: false,
        formattedNumber: null,
        error: "Phone number cannot be empty",
      };
    }

    // Parse the phone number
    const number = phoneUtil.parse(trimmedPhone, defaultRegion);

    // Check if the number is valid
    const isValid = phoneUtil.isValidNumber(number);

    if (!isValid) {
      return {
        isValid: false,
        formattedNumber: null,
        error: "Invalid phone number format",
      };
    }

    // Format the number in E.164 format (e.g., +959123456789)
    const formattedNumber = phoneUtil.format(number, PhoneNumberFormat.E164);

    // Get the region code
    const regionCode = phoneUtil.getRegionCodeForNumber(number);

    return {
      isValid: true,
      formattedNumber,
      regionCode,
      error: null,
    };
  } catch (error) {
    return {
      isValid: false,
      formattedNumber: null,
      error: error.message || "Invalid phone number format",
    };
  }
};

/**
 * Validates phone number and throws CustomError if invalid
 * Useful for controller-level validation
 * @param {string} phoneNumber - The phone number to validate
 * @param {string} defaultRegion - Default region code
 * @param {CustomError} CustomError - CustomError class for throwing errors
 * @returns {string} - Formatted phone number if valid
 * @throws {CustomError} - If phone number is invalid
 */
export const validatePhoneNumberOrThrow = (
  phoneNumber,
  defaultRegion = "MM",
  CustomError
) => {
  const validation = validatePhoneNumber(phoneNumber, defaultRegion);

  if (!validation.isValid) {
    throw new CustomError(400, validation.error || "Invalid phone number");
  }

  return validation.formattedNumber;
};

/**
 * Formats a phone number to a specific format
 * @param {string} phoneNumber - The phone number to format
 * @param {string} defaultRegion - Default region code
 * @param {PhoneNumberFormat} format - Format type (E164, INTERNATIONAL, NATIONAL, etc.)
 * @returns {string|null} - Formatted phone number or null if invalid
 */
export const formatPhoneNumber = (
  phoneNumber,
  defaultRegion = "MM",
  format = PhoneNumberFormat.E164
) => {
  try {
    if (!phoneNumber || typeof phoneNumber !== "string") {
      return null;
    }

    const trimmedPhone = phoneNumber.trim();
    if (!trimmedPhone) {
      return null;
    }

    const number = phoneUtil.parse(trimmedPhone, defaultRegion);

    if (!phoneUtil.isValidNumber(number)) {
      return null;
    }

    return phoneUtil.format(number, format);
  } catch (error) {
    return null;
  }
};

export default {
  validatePhoneNumber,
  validatePhoneNumberOrThrow,
  formatPhoneNumber,
};
