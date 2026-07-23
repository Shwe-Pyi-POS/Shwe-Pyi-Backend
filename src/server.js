import Db from "./configs/db.config.js";
import process from "node:process";
import app from "./app.js";
process.on("uncaughtException", (err) => {
  console.log("Inside uncaughtException handler");
  console.log(err.name, err.message);
  console.log("Uncaught Expection occured. Server is Shutting down!!!");
  process.exit(1);
});

const port = process.env.PORT || 5000;

(async () => {
  try {
    await Db();
  } catch (err) {
    console.log("Database connection failed:", err.message);
    process.exit(1);
  }

  app.listen(port, () => {
    console.log(`SERVER is Running at PORT:${port}`);
  });
})();

process.on("unhandledRejection", (err) => {
  console.log(err.name, err.message);
  console.log("Unhandle Rejection occured. Server is Shutting down!!!");
  process.exit(1);
});
