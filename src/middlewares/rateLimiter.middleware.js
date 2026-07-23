import rateLimit from "express-rate-limit";

export const apiRateLimiter = (maxRequests, timeWindow) => {
  return rateLimit({
    windowMs: timeWindow,
    max: maxRequests, // limit each IP to 100 requests per windowMs
    handler: (req, res, next) => {
      return res.status(429).json({
        code: 429,
        status: "failed",
        message: "Too many requests, please try again later.",
      });
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
};

export default apiRateLimiter;
