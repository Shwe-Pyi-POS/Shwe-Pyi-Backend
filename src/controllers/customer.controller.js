import Customer from "../models/customer.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import { signToken } from "../services/jwtToken.service.js";

export const register = asyncErrorHandler(async (req, res, next) => {
  const { name, phone, password } = req.body;

  if (!name || !phone || !password) {
    return next(new CustomError(400, "Name, phone and password are required."));
  }

  if (password.length < 6) {
    return next(new CustomError(400, "Password must be at least 6 characters."));
  }

  const existing = await Customer.findOne({ phone });
  if (existing) {
    return next(new CustomError(400, "Phone number already registered."));
  }

  const customer = await Customer.create({ name, phone, password });

  res.status(201).json({
    success: true,
    message: "Account created successfully.",
    data: {
      customer: {
        _id: customer._id,
        name: customer.name,
        phone: customer.phone,
      },
      token: signToken(customer._id, "customer"),
    },
  });
});

export const login = asyncErrorHandler(async (req, res, next) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return next(new CustomError(400, "Phone and password are required."));
  }

  const customer = await Customer.findOne({ phone }).select("+password");
  if (!customer) {
    return next(new CustomError(401, "Invalid phone or password."));
  }
  if (!customer.isActive) {
    return next(new CustomError(401, "Your account has been deactivated."));
  }

  const isMatch = await customer.comparePassword(password);
  if (!isMatch) {
    return next(new CustomError(401, "Invalid phone or password."));
  }

  res.status(200).json({
    success: true,
    message: "Login successful.",
    data: {
      customer: {
        _id: customer._id,
        name: customer.name,
        phone: customer.phone,
      },
      token: signToken(customer._id, "customer"),
    },
  });
});

export const getMe = asyncErrorHandler(async (req, res, next) => {
  res.status(200).json({
    success: true,
    data: req.customer,
  });
});

export const getAllCustomers = asyncErrorHandler(async (req, res, next) => {
  const { page, limit, search } = req.query;
  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 20;
  const skip = (pageNum - 1) * limitNum;

  const filter = {};
  if (search && search.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { name: { $regex: escaped, $options: "i" } },
      { phone: { $regex: escaped, $options: "i" } },
    ];
  }

  const [customers, total] = await Promise.all([
    Customer.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum),
    Customer.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: customers,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      totalItems: total,
      itemsPerPage: limitNum,
    },
  });
});

export const updateMe = asyncErrorHandler(async (req, res, next) => {
  const { name, phone, password, addresses } = req.body;
  const customer = req.customer;

  if (name) customer.name = name;

  if (phone && phone !== customer.phone) {
    const existing = await Customer.findOne({ phone });
    if (existing) {
      return next(new CustomError(400, "Phone number already in use."));
    }
    customer.phone = phone;
  }

  if (password) {
    if (password.length < 6) {
      return next(new CustomError(400, "Password must be at least 6 characters."));
    }
    customer.password = password;
  }

  if (addresses) customer.addresses = addresses;

  await customer.save();

  res.status(200).json({
    success: true,
    message: "Profile updated successfully.",
    data: customer,
  });
});

export const updateCustomerByAdmin = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const { name, phone, password, isActive, addresses } = req.body;

  const customer = await Customer.findById(id);
  if (!customer) {
    return next(new CustomError(404, "Customer not found"));
  }

  if (name !== undefined) customer.name = name;

  if (phone !== undefined) {
    if (phone !== customer.phone) {
      const existing = await Customer.findOne({ phone });
      if (existing) {
        return next(new CustomError(400, "Phone number already in use."));
      }
      customer.phone = phone;
    }
  }

  if (password !== undefined) {
    if (password.length < 6) {
      return next(new CustomError(400, "Password must be at least 6 characters."));
    }
    customer.password = password;
  }

  if (isActive !== undefined) customer.isActive = isActive;
  if (addresses !== undefined) customer.addresses = addresses;

  await customer.save();

  res.status(200).json({
    success: true,
    message: "Customer updated successfully.",
    data: customer,
  });
});
