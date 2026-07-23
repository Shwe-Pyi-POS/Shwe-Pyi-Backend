import jwt from "jsonwebtoken";
import util from "util";
import Customer from "../models/customer.model.js";
import CustomError from "../utils/customError.js";

export const customerProtect = async (req, res, next) => {
  const testToken = req.headers.authorization;
  let token;
  if (testToken && testToken.startsWith("Bearer")) {
    token = testToken.split(" ")[1];
  }
  if (!token) {
    return next(new CustomError(401, "You are not logged in! Please login."));
  }

  const verifyAsync = util.promisify(jwt.verify);
  const decodedToken = await verifyAsync(token, process.env.JWT_SECRET);

  const customer = await Customer.findById(decodedToken.id);
  if (!customer) {
    return next(new CustomError(401, "Customer account not found."));
  }
  if (!customer.isActive) {
    return next(new CustomError(401, "Your account has been deactivated."));
  }

  req.customer = customer;
  next();
};
