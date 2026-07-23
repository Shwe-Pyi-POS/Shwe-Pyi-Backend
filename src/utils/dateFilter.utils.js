import moment from "moment-timezone";
import CustomError from "./customError.js";

/**
 * Creates a MongoDB date filter object based on startDate and endDate query parameters
 * Dates are parsed in UTC timezone to match MongoDB's date storage
 * @param {Object} query - Express request query object
 * @param {string} dateField - The field name to filter on (default: 'createdAt')
 * @param {boolean} isStringField - Whether the date field is stored as a string (default: false)
 * @returns {Object} MongoDB filter object for date range
 * @throws {CustomError} If date format is invalid or startDate > endDate
 */
export const createDateFilter = (
  query,
  dateField = "createdAt",
  isStringField = false
) => {
  const { startDate, endDate } = query;
  const dateFilter = {};

  // If no date parameters provided, return empty filter
  if (!startDate && !endDate) {
    return dateFilter;
  }

  let startMoment = null;
  let endMoment = null;

  // Parse startDate in UTC
  if (startDate) {
    // Try parsing with common date formats
    const dateFormats = [
      "YYYY-MM-DD",
      "YYYY-MM-DD HH:mm:ss",
      "YYYY-MM-DD HH:mm",
      "YYYY/MM/DD",
      "DD-MM-YYYY",
    ];

    startMoment = null;
    for (const format of dateFormats) {
      startMoment = moment.tz(startDate, format, "Asia/Yangon");
      if (startMoment.isValid()) {
        break;
      }
    }

    // If still not valid, try parsing without format (moment's default parsing in UTC)
    if (!startMoment || !startMoment.isValid()) {
      startMoment = moment.tz(startDate, "Asia/Yangon");
    }

    if (!startMoment.isValid()) {
      throw new CustomError(
        400,
        `Invalid startDate format: "${startDate}". Please use a valid date format (e.g., YYYY-MM-DD or YYYY-MM-DD HH:mm:ss).`
      );
    }
    // For Date fields, set to start of day in UTC
    // For string fields, we'll just extract the date part later
    if (!isStringField) {
      startMoment.startOf("day");
    }
  }

  // Parse endDate in UTC
  if (endDate) {
    // Try parsing with common date formats
    const dateFormats = [
      "YYYY-MM-DD",
      "YYYY-MM-DD HH:mm:ss",
      "YYYY-MM-DD HH:mm",
      "YYYY/MM/DD",
      "DD-MM-YYYY",
    ];

    endMoment = null;
    for (const format of dateFormats) {
      endMoment = moment.tz(endDate, format, "Asia/Yangon");
      if (endMoment.isValid()) {
        break;
      }
    }

    // If still not valid, try parsing without format (moment's default parsing in UTC)
    if (!endMoment || !endMoment.isValid()) {
      endMoment = moment.tz(endDate, "Asia/Yangon");
    }

    if (!endMoment.isValid()) {
      throw new CustomError(
        400,
        `Invalid endDate format: "${endDate}". Please use a valid date format (e.g., YYYY-MM-DD or YYYY-MM-DD HH:mm:ss).`
      );
    }
    // For Date fields, set to end of day in UTC
    // For string fields, we'll just extract the date part later
    if (!isStringField) {
      endMoment.endOf("day");
    }
  }

  // Validate date range
  // For string fields, compare the date part only (YYYY-MM-DD)
  // For Date fields, compare the full moment objects
  if (startMoment && endMoment) {
    if (isStringField) {
      const startDateStr = startMoment.format("YYYY-MM-DD");
      const endDateStr = endMoment.format("YYYY-MM-DD");
      if (startDateStr > endDateStr) {
        throw new CustomError(400, "startDate cannot be after endDate.");
      }
    } else {
      if (startMoment.isAfter(endMoment)) {
        throw new CustomError(400, "startDate cannot be after endDate.");
      }
    }
  }

  // Build MongoDB date filter
  if (isStringField) {
    // For string date fields, format as YYYY-MM-DD for lexicographic comparison
    if (startMoment && endMoment) {
      // Both dates provided - range filter
      const startDateStr = startMoment.format("YYYY-MM-DD");
      // Use $lt with next day to include all times for the end date (e.g., "2025-11-25 23:59:59")
      // This ensures when startDate=endDate, we get all 24 hours of that day
      const nextDay = endMoment.clone().add(1, "day").format("YYYY-MM-DD");
      dateFilter[dateField] = {
        $gte: startDateStr,
        $lt: nextDay,
      };
    } else if (startMoment) {
      // Only startDate provided
      dateFilter[dateField] = {
        $gte: startMoment.format("YYYY-MM-DD"),
      };
    } else if (endMoment) {
      // Only endDate provided - use $lt with next day to include all times for that day
      const nextDay = endMoment.clone().add(1, "day").format("YYYY-MM-DD");
      dateFilter[dateField] = {
        $lt: nextDay,
      };
    }
  } else {
    // For Date fields, use Date objects
    if (startMoment && endMoment) {
      // Both dates provided - range filter
      dateFilter[dateField] = {
        $gte: startMoment.toDate(),
        $lte: endMoment.toDate(),
      };
    } else if (startMoment) {
      // Only startDate provided
      dateFilter[dateField] = {
        $gte: startMoment.toDate(),
      };
    } else if (endMoment) {
      // Only endDate provided
      dateFilter[dateField] = {
        $lte: endMoment.toDate(),
      };
    }

    // Ensure we return Date objects, not strings
    if (dateFilter[dateField]) {
      if (
        dateFilter[dateField].$gte &&
        !(dateFilter[dateField].$gte instanceof Date)
      ) {
        dateFilter[dateField].$gte = new Date(dateFilter[dateField].$gte);
      }
      if (
        dateFilter[dateField].$lte &&
        !(dateFilter[dateField].$lte instanceof Date)
      ) {
        dateFilter[dateField].$lte = new Date(dateFilter[dateField].$lte);
      }
    }
  }

  return dateFilter;
};

// import moment from "moment-timezone";
// import CustomError from "./customError.js";

// /**
//  * Creates a MongoDB date filter object based on startDate and endDate query parameters
//  * Dates are parsed in UTC timezone to match MongoDB's date storage
//  * @param {Object} query - Express request query object
//  * @param {string} dateField - The field name to filter on (default: 'createdAt')
//  * @param {boolean} isStringField - Whether the date field is stored as a string (default: false)
//  * @returns {Object} MongoDB filter object for date range
//  * @throws {CustomError} If date format is invalid or startDate > endDate
//  */
// export const createDateFilter = (
//   query,
//   dateField = "createdAt",
//   isStringField = false
// ) => {
//   // Use specific query parameters if available, otherwise fallback to generic startDate/endDate
//   // e.g., if dateField is 'paymentDate', it will look for 'paymentStartDate' then 'startDate'
//   const fieldPrefix = dateField.endsWith("Date")
//     ? dateField.slice(0, -4)
//     : dateField;
//   const startDate = query[`${fieldPrefix}StartDate`] || query.startDate;
//   const endDate = query[`${fieldPrefix}EndDate`] || query.endDate;

//   const dateFilter = {};

//   // If no date parameters provided, return empty filter
//   if (!startDate && !endDate) {
//     return dateFilter;
//   }

//   let startMoment = null;
//   let endMoment = null;

//   // Parse startDate in UTC
//   if (startDate) {
//     // Try parsing with common date formats
//     const dateFormats = [
//       "YYYY-MM-DD",
//       "YYYY-MM-DD HH:mm:ss",
//       "YYYY-MM-DD HH:mm",
//       "YYYY/MM/DD",
//       "DD-MM-YYYY",
//     ];

//     startMoment = null;
//     for (const format of dateFormats) {
//       startMoment = moment.utc(startDate, format);
//       if (startMoment.isValid()) {
//         break;
//       }
//     }

//     // If still not valid, try parsing without format (moment's default parsing in UTC)
//     if (!startMoment || !startMoment.isValid()) {
//       startMoment = moment.utc(startDate);
//     }

//     if (!startMoment.isValid()) {
//       throw new CustomError(
//         400,
//         `Invalid startDate format: "${startDate}". Please use a valid date format (e.g., YYYY-MM-DD or YYYY-MM-DD HH:mm:ss).`
//       );
//     }
//     // For Date fields, set to start of day in UTC
//     // For string fields, we'll just extract the date part later
//     if (!isStringField) {
//       startMoment.startOf("day");
//     }
//   }

//   // Parse endDate in UTC
//   if (endDate) {
//     // Try parsing with common date formats
//     const dateFormats = [
//       "YYYY-MM-DD",
//       "YYYY-MM-DD HH:mm:ss",
//       "YYYY-MM-DD HH:mm",
//       "YYYY/MM/DD",
//       "DD-MM-YYYY",
//     ];

//     endMoment = null;
//     for (const format of dateFormats) {
//       endMoment = moment.utc(endDate, format);
//       if (endMoment.isValid()) {
//         break;
//       }
//     }

//     // If still not valid, try parsing without format (moment's default parsing in UTC)
//     if (!endMoment || !endMoment.isValid()) {
//       endMoment = moment.utc(endDate);
//     }

//     if (!endMoment.isValid()) {
//       throw new CustomError(
//         400,
//         `Invalid endDate format: "${endDate}". Please use a valid date format (e.g., YYYY-MM-DD or YYYY-MM-DD HH:mm:ss).`
//       );
//     }
//     // For Date fields, set to end of day in UTC
//     // For string fields, we'll just extract the date part later
//     if (!isStringField) {
//       endMoment.endOf("day");
//     }
//   }

//   // Validate date range
//   // For string fields, compare the date part only (YYYY-MM-DD)
//   // For Date fields, compare the full moment objects
//   if (startMoment && endMoment) {
//     if (isStringField) {
//       const startDateStr = startMoment.format("YYYY-MM-DD");
//       const endDateStr = endMoment.format("YYYY-MM-DD");
//       if (startDateStr > endDateStr) {
//         throw new CustomError(400, "startDate cannot be after endDate.");
//       }
//     } else {
//       if (startMoment.isAfter(endMoment)) {
//         throw new CustomError(400, "startDate cannot be after endDate.");
//       }
//     }
//   }

//   // Build MongoDB date filter
//   if (isStringField) {
//     // For string date fields, format as YYYY-MM-DD for lexicographic comparison
//     if (startMoment && endMoment) {
//       // Both dates provided - range filter
//       const startDateStr = startMoment.format("YYYY-MM-DD");
//       // Use $lt with next day to include all times for the end date (e.g., "2025-11-25 23:59:59")
//       // This ensures when startDate=endDate, we get all 24 hours of that day
//       const nextDay = endMoment.clone().add(1, "day").format("YYYY-MM-DD");
//       dateFilter[dateField] = {
//         $gte: startDateStr,
//         $lt: nextDay,
//       };
//     } else if (startMoment) {
//       // Only startDate provided
//       dateFilter[dateField] = {
//         $gte: startMoment.format("YYYY-MM-DD"),
//       };
//     } else if (endMoment) {
//       // Only endDate provided - use $lt with next day to include all times for that day
//       const nextDay = endMoment.clone().add(1, "day").format("YYYY-MM-DD");
//       dateFilter[dateField] = {
//         $lt: nextDay,
//       };
//     }
//   } else {
//     // For Date fields, use Date objects
//     if (startMoment && endMoment) {
//       // Both dates provided - range filter
//       dateFilter[dateField] = {
//         $gte: startMoment.toDate(),
//         $lte: endMoment.toDate(),
//       };
//     } else if (startMoment) {
//       // Only startDate provided
//       dateFilter[dateField] = {
//         $gte: startMoment.toDate(),
//       };
//     } else if (endMoment) {
//       // Only endDate provided
//       dateFilter[dateField] = {
//         $lte: endMoment.toDate(),
//       };
//     }

//     // Ensure we return Date objects, not strings
//     if (dateFilter[dateField]) {
//       if (
//         dateFilter[dateField].$gte &&
//         !(dateFilter[dateField].$gte instanceof Date)
//       ) {
//         dateFilter[dateField].$gte = new Date(dateFilter[dateField].$gte);
//       }
//       if (
//         dateFilter[dateField].$lte &&
//         !(dateFilter[dateField].$lte instanceof Date)
//       ) {
//         dateFilter[dateField].$lte = new Date(dateFilter[dateField].$lte);
//       }
//     }
//   }

//   return dateFilter;
// };
