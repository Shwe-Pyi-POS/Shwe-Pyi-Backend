import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Admin from './src/models/admin.model.js';

dotenv.config({ path: './.env' });

const createAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    const adminExists = await Admin.findOne({ name: 'owner' });
    if (adminExists) {
      console.log('Admin user already exists.');
      mongoose.connection.close();
      return;
    }

    await Admin.create({
      name: 'owner',
      password: '123456',
      confirmPassword: '123456',
      role: 'owner',
    });

    console.log('Admin user created successfully.');
    mongoose.connection.close();
  } catch (error) {
    console.error('Error creating admin user:', error);
    mongoose.connection.close();
  }
};

createAdmin();
