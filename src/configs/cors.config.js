import cors from "cors";

export const configureCors = () => {
  return cors({
    origin: (origin, callback) => {
      const allowedOrigins = "*";
      //   [
      //     "http://localhost:3000",
      //     "http://localhost:4200",
      //     "http://localhost:5173",
      //   ];

      if (!origin || allowedOrigins.includes(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept-Version"],
    exposedHeaders: ["X-Total-Count", "Content-Range"],
    credentials: true, //enable support for cookies
    preflightContinue: false,
    maxAge: 600, //cache pre flight reponses for 10 minutes -> sending options multiple times
    optionsSuccessStatus: 204, //some old browsers (IE11, various SmartTVs) choke on 200 for preflight
  });
};

export default configureCors;
