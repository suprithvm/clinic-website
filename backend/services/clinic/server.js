import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { connectDB } from '../shared/database.js';
import { User } from '../shared/models/User.js';
import { Appointment } from '../shared/models/Appointment.js';
import { Prescription } from '../shared/models/Prescription.js';
import { PharmacyOrder } from '../shared/models/PharmacyOrder.js';
import { localFileStorage } from '../shared/localStorage.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import puppeteer from 'puppeteer';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
//import { queue } from '../email/emailQueue.js';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: '../../.env' });

const app = express();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow images and PDFs
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only images and PDFs are allowed'), false);
    }
  }
});
const PORT = process.env.CLINIC_PORT || 3001;

// ===========================================
// MIDDLEWARE SETUP
// ===========================================

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(compression());

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// ===========================================
// DATABASE CONNECTION
// ===========================================

await connectDB();

// ===========================================
// AUTHENTICATION MIDDLEWARE
// ===========================================

// Authentication middleware
const authenticateToken = async (req, res, next) => {
  try {
    console.log('=== CLINIC SERVICE: Authentication check ===');
    console.log('Headers:', req.headers);
    console.log('Authorization header:', req.headers['authorization']);
    
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    
    console.log('Extracted token:', token ? 'Present' : 'Missing');

    if (!token) {
      return res.status(401).json({
        error: 'Access token required',
        code: 'TOKEN_REQUIRED'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('Token decoded successfully:', decoded);
    
    // Find user in database to get current role and details
    const user = await User.findById(decoded.userId).select('_id firstName lastName email role');
    console.log('User found:', user);
    
    if (!user) {
      console.log('User not found in database');
      return res.status(401).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    req.user = {
      id: user._id.toString(),
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role
    };

    console.log('Authentication successful, proceeding to route handler');
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(403).json({
      error: 'Invalid or expired token',
      code: 'INVALID_TOKEN'
    });
  }
};

// ===========================================
// APPOINTMENT ROUTES
// ===========================================

// Get appointments
app.get('/api/appointments', async (req, res) => {
  try {
    const appointments = await Appointment.find()
      .populate('patientId', 'firstName lastName email phone')
      .populate('doctorId', 'firstName lastName email')
      .sort({ scheduledAt: -1 })
      .limit(100);
    
    const formattedAppointments = appointments.map(apt => {
      // Handle null patientId or doctorId
      const patientName = apt.patientId 
        ? `${apt.patientId.firstName || 'Unknown'} ${apt.patientId.lastName || 'Patient'}`
        : 'Unknown Patient';
      
      const doctorName = apt.doctorId 
        ? `Dr. ${apt.doctorId.firstName || 'Unknown'} ${apt.doctorId.lastName || 'Doctor'}`
        : 'Unknown Doctor';
      
      const phone = apt.patientId?.phone || 'N/A';
      const email = apt.patientId?.email || 'N/A';
      
      // Log data quality issues for debugging
      if (!apt.patientId) {
        console.warn(`Appointment ${apt._id} has null patientId`);
      }
      if (!apt.doctorId) {
        console.warn(`Appointment ${apt._id} has null doctorId`);
      }
      
      return {
      id: apt._id,
        patientName,
        doctorName,
      date: apt.scheduledAt.toISOString().split('T')[0],
      time: apt.scheduledAt.toTimeString().split(' ')[0].substring(0, 5),
      status: apt.status,
        reason: apt.reason || 'No reason provided',
        phone,
        email
      };
    });
    
    res.json({
      success: true,
      data: formattedAppointments,
      total: formattedAppointments.length,
      orphanedCount: formattedAppointments.filter(apt => 
        apt.patientName === 'Unknown Patient' || apt.doctorName === 'Unknown Doctor'
      ).length
    });
  } catch (error) {
    console.error('Get appointments error:', error);
    res.status(500).json({
      error: 'Failed to fetch appointments',
      code: 'FETCH_ERROR',
      details: error.message
    });
  }
});

// Data cleanup endpoint for orphaned appointments
app.get('/api/appointments/cleanup', async (req, res) => {
  try {
    // Find appointments with null patientId or doctorId
    const orphanedAppointments = await Appointment.find({
      $or: [
        { patientId: null },
        { doctorId: null }
      ]
    });

    console.log(`Found ${orphanedAppointments.length} orphaned appointments`);

    // Optionally delete orphaned appointments (uncomment if needed)
    await Appointment.deleteMany({
      $or: [
        { patientId: null },
        { doctorId: null }
      ]
    });

    res.json({
      success: true,
      message: `Found ${orphanedAppointments.length} orphaned appointments`,
      orphanedCount: orphanedAppointments.length,
      orphanedIds: orphanedAppointments.map(apt => apt._id)
    });
  } catch (error) {
    console.error('Cleanup appointments error:', error);
    res.status(500).json({
      error: 'Failed to cleanup appointments',
      code: 'CLEANUP_ERROR'
    });
  }
});

// ===========================================
// PUBLIC ROUTES (No Authentication Required)
// ===========================================

// Health check for clinic service
app.get('/api/public/health', (req, res) => {
  console.log('Clinic Service: Health check requested');
  res.json({ 
    success: true, 
    message: 'Clinic service is running',
    timestamp: new Date().toISOString()
  });
});

// Public appointment booking (for frontend booking page)
app.post('/api/public/appointments', async (req, res) => {
  try {
    console.log('=== CLINIC SERVICE: Public appointment request received ===');
    console.log('Method:', req.method);
    console.log('URL:', req.url);
    console.log('Request body:', req.body);
    console.log('Request headers:', req.headers);
    console.log('========================================================');
    
    const { patientName, doctorName, date, time, reason, phone, email } = req.body;
    
    console.log('Creating appointment with data:', { patientName, doctorName, date, time, reason, phone, email });
    
    // Validation
    if (!patientName || !doctorName || !date || !time) {
      return res.status(400).json({
        error: 'Missing required fields',
        code: 'MISSING_FIELDS'
      });
    }
    
    // Find or create patient
    let patient = await User.findOne({ 
      $or: [
        { email: email },
        { firstName: patientName.split(' ')[0], lastName: patientName.split(' ')[1] }
      ]
    });
    
    if (!patient) {
      console.log('Creating new patient...');
      // Hash password for patient
      const bcrypt = require('bcryptjs');
      const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
      const hashedPassword = await bcrypt.hash('patient123', saltRounds);
      
      // Create new patient
      patient = new User({
        firstName: patientName.split(' ')[0],
        lastName: patientName.split(' ')[1] || '',
        email: email || `${patientName.toLowerCase().replace(' ', '.')}@example.com`,
        phone: phone || '+91-0000000000',
        role: 'patient',
        password: hashedPassword,
        isActive: true
      });
      await patient.save();
      console.log('Patient created successfully');
    } else {
      console.log('Found existing patient');
    }
    
    // Find doctor by name (improved logic)
    const doctorNameParts = doctorName.replace('Dr. ', '').split(' ');
    const doctor = await User.findOne({ 
      role: 'doctor',
      $or: [
        { firstName: doctorNameParts[0], lastName: doctorNameParts[1] },
        { firstName: doctorNameParts[0] },
        { lastName: doctorNameParts[1] }
      ]
    });
    
    if (!doctor) {
      console.log('Doctor not found, using first available doctor');
      // If doctor not found, use the first available doctor
      const firstDoctor = await User.findOne({ role: 'doctor', isActive: true });
      if (!firstDoctor) {
      return res.status(400).json({
          error: 'No doctors available',
          code: 'NO_DOCTORS_AVAILABLE'
      });
      }
      doctor = firstDoctor;
    }
    
    console.log('Using doctor:', doctor.firstName, doctor.lastName);
    
    // Create appointment
    const appointment = new Appointment({
      appointmentId: `APT${Date.now()}`,
      patientId: patient._id,
      doctorId: doctor._id,
      scheduledAt: new Date(`${date}T${time}:00`),
      status: 'confirmed',
      reason: reason || 'General consultation',
      createdBy: patient._id // Use patient ID as creator for public bookings
    });
    
    console.log('Saving appointment to database...');
    await appointment.save();
    console.log('Appointment saved successfully');
    
    // Populate the response
    await appointment.populate('patientId', 'firstName lastName email phone');
    await appointment.populate('doctorId', 'firstName lastName email');
    
    const formattedAppointment = {
      id: appointment._id,
      patientName: `${appointment.patientId.firstName} ${appointment.patientId.lastName}`,
      doctorName: `Dr. ${appointment.doctorId.firstName} ${appointment.doctorId.lastName}`,
      date: appointment.scheduledAt.toISOString().split('T')[0],
      time: appointment.scheduledAt.toTimeString().split(' ')[0].substring(0, 5),
      status: appointment.status,
      reason: appointment.reason,
      phone: appointment.patientId.phone,
      email: appointment.patientId.email
    };
    
    res.status(201).json({
      success: true,
      message: 'Appointment created successfully',
      data: formattedAppointment
    });
  } catch (error) {
    console.error('Create appointment error:', error);
    res.status(500).json({
      error: 'Failed to create appointment',
      code: 'CREATE_ERROR'
    });
  }
});

// Public doctors list (for booking page)
app.get('/api/public/doctors', async (req, res) => {
  try {
    console.log('Clinic Service: Public doctors request received');
    
    const doctors = await User.find({ 
      role: 'doctor', 
      isActive: true 
    }).select('firstName lastName email doctorInfo');

    const formattedDoctors = doctors.map(doctor => ({
      id: doctor._id,
      name: `Dr. ${doctor.firstName} ${doctor.lastName}`,
      email: doctor.email,
      specialty: doctor.doctorInfo?.specialization?.[0] || 'General Medicine',
      experience: doctor.doctorInfo?.experience || 0,
      qualification: doctor.doctorInfo?.qualification || '',
      consultationFee: doctor.doctorInfo?.consultationFee || 500,
      rating: 4.8 // Default rating
    }));
    
    res.json({
      success: true,
      data: formattedDoctors
    });
  } catch (error) {
    console.error('Get public doctors error:', error);
    res.status(500).json({
      error: 'Failed to fetch doctors',
      code: 'FETCH_ERROR'
    });
  }
});

// ===========================================
// PROTECTED ROUTES (Authentication Required)
// ===========================================

// Get appointment by ID
app.get('/api/appointments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const appointment = await Appointment.findById(id)
      .populate('patientId', 'firstName lastName email phone patientInfo')
      .populate('doctorId', 'firstName lastName email doctorInfo')
      .populate('createdBy', 'firstName lastName email role');
    
    if (!appointment) {
      return res.status(404).json({
        error: 'Appointment not found',
        code: 'APPOINTMENT_NOT_FOUND'
      });
    }
    
    const detailedAppointment = {
      id: appointment._id,
      appointmentId: appointment.appointmentId,
      patient: {
        id: appointment.patientId._id,
        name: `${appointment.patientId.firstName} ${appointment.patientId.lastName}`,
        email: appointment.patientId.email,
        phone: appointment.patientId.phone,
        info: appointment.patientId.patientInfo
      },
      doctor: {
        id: appointment.doctorId._id,
        name: `Dr. ${appointment.doctorId.firstName} ${appointment.doctorId.lastName}`,
        email: appointment.doctorId.email,
        info: appointment.doctorId.doctorInfo
      },
      createdBy: {
        id: appointment.createdBy._id,
        name: `${appointment.createdBy.firstName} ${appointment.createdBy.lastName}`,
        email: appointment.createdBy.email,
        role: appointment.createdBy.role
      },
      scheduledAt: appointment.scheduledAt,
      duration: appointment.duration,
      status: appointment.status,
      type: appointment.type,
      reason: appointment.reason,
      notes: appointment.notes,
      checkedInAt: appointment.checkedInAt,
      startedAt: appointment.startedAt,
      completedAt: appointment.completedAt,
      consultationFee: appointment.consultationFee,
      paymentStatus: appointment.paymentStatus,
      createdAt: appointment.createdAt,
      updatedAt: appointment.updatedAt
    };
    
    res.json({
      success: true,
      data: detailedAppointment
    });
  } catch (error) {
    console.error('Get appointment error:', error);
    res.status(500).json({
      error: 'Failed to fetch appointment',
      code: 'FETCH_ERROR'
    });
  }
});



// Update appointment status
// REPLACE the app.patch route (lines 431-509) with this:

// Update appointment (status, reschedule, etc.)
app.patch('/api/appointments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, consultationFee, paymentStatus, date, time } = req.body;
    
    // Find appointment
    const appointment = await Appointment.findById(id);
    if (!appointment) {
      return res.status(404).json({
        error: 'Appointment not found',
        code: 'APPOINTMENT_NOT_FOUND'
      });
    }

    // Handle rescheduling
    if (date && time) {
      appointment.scheduledAt = new Date(`${date}T${time}:00`);
      console.log(`[Clinic] Rescheduled appointment ${id} to: ${appointment.scheduledAt}`);
    }
   
    // Handle other optional fields
    if (notes) appointment.notes = notes;
    if (consultationFee !== undefined) appointment.consultationFee = consultationFee;
    if (paymentStatus) appointment.paymentStatus = paymentStatus;
    
    // Handle status updates
    if (status) {
      appointment.status = status;
      switch (status) {
        case 'checked-in':
          appointment.checkedInAt = new Date();
          break;
        case 'in-progress':
          appointment.startedAt = new Date();
          break;
        case 'completed':
          appointment.completedAt = new Date();
          break;
      }
    } 
    
    await appointment.save();
    
    // Populate the response
    await appointment.populate('patientId', 'firstName lastName email phone');
    await appointment.populate('doctorId', 'firstName lastName email');
    
    // --- THIS IS THE FIX ---
    // Safely handle null patientId or doctorId
    const patientName = appointment.patientId 
      ? `${appointment.patientId.firstName || 'Unknown'} ${appointment.patientId.lastName || 'Patient'}`
      : 'Unknown Patient';
    
    const doctorName = appointment.doctorId 
      ? `Dr. ${appointment.doctorId.firstName || 'Unknown'} ${appointment.doctorId.lastName || 'Doctor'}`
      : 'Unknown Doctor';
    
    const phone = appointment.patientId?.phone || 'N/A';
    const email = appointment.patientId?.email || 'N/A';
    // --- END FIX ---
    
    const formattedAppointment = {
      id: appointment._id,
      appointmentId: appointment.appointmentId,
      patientName, // Use the safe variable
      doctorName,  // Use the safe variable
      date: appointment.scheduledAt.toISOString().split('T')[0],
      time: appointment.scheduledAt.toTimeString().split(' ')[0].substring(0, 5),
      status: appointment.status,
      reason: appointment.reason,
      notes: appointment.notes,
      consultationFee: appointment.consultationFee,
      paymentStatus: appointment.paymentStatus,
      phone, // Use the safe variable
      email, // Use the safe variable
      checkedInAt: appointment.checkedInAt,
      startedAt: appointment.startedAt,
      completedAt: appointment.completedAt,
      updatedAt: appointment.updatedAt
    };
    
    res.json({
      success: true,
      message: 'Appointment updated successfully',
      data: formattedAppointment
    });
  } catch (error) {
    console.error('Update appointment error:', error);
    res.status(500).json({
      error: 'Failed to update appointment',
      code: 'UPDATE_ERROR',
      // Add details to the error message for easier debugging in the future
      details: error.message 
    });
  }
});

// Data cleanup endpoint for orphaned appointments
app.get('/api/appointments/cleanup', async (req, res) => {
  try {
    // Find appointments with null patientId or doctorId
    const orphanedAppointments = await Appointment.find({
      $or: [
        { patientId: null },
        { doctorId: null }
      ]
    });

    console.log(`Found ${orphanedAppointments.length} orphaned appointments`);

    // Optionally delete orphaned appointments (uncomment if needed)
    // await Appointment.deleteMany({
    //   $or: [
    //     { patientId: null },
    //     { doctorId: null }
    //   ]
    // });

    res.json({
      success: true,
      message: `Found ${orphanedAppointments.length} orphaned appointments`,
      orphanedCount: orphanedAppointments.length,
      orphanedIds: orphanedAppointments.map(apt => apt._id)
    });
  } catch (error) {
    console.error('Cleanup appointments error:', error);
    res.status(500).json({
      error: 'Failed to cleanup appointments',
      code: 'CLEANUP_ERROR'
    });
  }
});

// Confirm appointment (Admin/Receptionist)
app.patch('/api/appointments/:id/confirm', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    // Check if user has permission to confirm appointments
    if (!['admin', 'receptionist'].includes(user.role)) {
      return res.status(403).json({
        error: 'Insufficient permissions. Only admin and receptionist can confirm appointments.',
        code: 'PERMISSION_DENIED'
      });
    }

    const appointment = await Appointment.findByIdAndUpdate(
      id,
      { 
        status: 'confirmed',
        confirmedAt: new Date(),
        confirmedBy: user.id
      },
      { new: true }
    )
      .populate('patientId', 'firstName lastName email phone')
      .populate('doctorId', 'firstName lastName email');

    if (!appointment) {
      return res.status(404).json({
        error: 'Appointment not found',
        code: 'APPOINTMENT_NOT_FOUND'
      });
    }

    // Handle null references safely
    const patientName = appointment.patientId 
      ? `${appointment.patientId.firstName || 'Unknown'} ${appointment.patientId.lastName || 'Patient'}`
      : 'Unknown Patient';
    
    const doctorName = appointment.doctorId 
      ? `Dr. ${appointment.doctorId.firstName || 'Unknown'} ${appointment.doctorId.lastName || 'Doctor'}`
      : 'Unknown Doctor';
   /* 
    // Add Job to email Queue
    await queue.add("emailQueue", {
      template: "appointment_confirmed",
      to: appointment.patientId?.email,
      data: {
        patientName,
        doctorName,
        appointmentDate: appointment.scheduledAt.toISOString().split('T')[0],
        appointmentTime: appointment.scheduledAt.toTimeString().split(' ')[0].substring(0, 5),
        appointmentReason: appointment.reason || 'No reason provided',
      },
    });
    */
   
    res.json({
      success: true,
      message: 'Appointment confirmed successfully',
      data: {
        id: appointment._id,
        patientName,
        doctorName,
        date: appointment.scheduledAt.toISOString().split('T')[0],
        time: appointment.scheduledAt.toTimeString().split(' ')[0].substring(0, 5),
        status: appointment.status,
        reason: appointment.reason || 'No reason provided',
        phone: appointment.patientId?.phone || 'N/A',
        email: appointment.patientId?.email || 'N/A',
        confirmedAt: appointment.confirmedAt,
        confirmedBy: user.firstName + ' ' + user.lastName
      }
    });
  } catch (error) {
    console.error('Confirm appointment error:', error);
    res.status(500).json({
      error: 'Failed to confirm appointment',
      code: 'CONFIRM_ERROR',
      details: error.message
    });
  }
});
// Delete appointment (Admin/Receptionist)
app.delete('/api/appointments/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Check for admin/receptionist role
    if (!['admin', 'receptionist'].includes(req.user.role)) {
      return res.status(403).json({
        error: 'Insufficient permissions. Only admin and receptionist can delete appointments.',
        code: 'PERMISSION_DENIED'
      });
    }

    // Find and delete the appointment
    const appointment = await Appointment.findByIdAndDelete(id);

    if (!appointment) {
      return res.status(404).json({
        error: 'Appointment not found',
        code: 'APPOINTMENT_NOT_FOUND'
      });
    }

    console.log(`[Clinic] Appointment DELETED: ${id} by ${req.user.email}`);
    
    res.json({ 
      success: true, 
      message: 'Appointment deleted successfully',
      data: appointment // Send back the deleted item
    });

  } catch (error) {
    console.error('Delete appointment error:', error);
    res.status(500).json({
      error: 'Failed to delete appointment',
      code: 'DELETE_ERROR'
    });
  }
});
// Mark appointment as attended/not attended (Receptionist only)
app.patch('/api/appointments/:id/attendance', authenticateToken, async (req, res) => {
  try {
    console.log('=== CLINIC SERVICE: Mark attendance request received ===');
    console.log('Method:', req.method);
    console.log('URL:', req.url);
    console.log('Params:', req.params);
    console.log('Body:', req.body);
    console.log('Headers:', req.headers);
    console.log('User:', req.user);
    console.log('========================================================');
    
    const { id } = req.params;
    const { attended } = req.body;
    const user = req.user;

    // Check if user has permission to mark attendance
    if (user.role !== 'receptionist') {
      return res.status(403).json({
        error: 'Only receptionists and admins can mark attendance',
        code: 'PERMISSION_DENIED'
      });
    }

    if (typeof attended !== 'boolean') {
      return res.status(400).json({
        error: 'attended field must be a boolean',
        code: 'INVALID_DATA'
      });
    }

    const appointment = await Appointment.findByIdAndUpdate(
      id,
      { 
        status: attended ? 'waiting' : 'not-attended',
        attendedAt: attended ? new Date() : null,
        markedBy: user.id
      },
      { new: true }
    )
      .populate('patientId', 'firstName lastName email phone')
      .populate('doctorId', 'firstName lastName email');

    if (!appointment) {
      return res.status(404).json({
        error: 'Appointment not found',
        code: 'APPOINTMENT_NOT_FOUND'
      });
    }

    // Handle null references safely
    const patientName = appointment.patientId 
      ? `${appointment.patientId.firstName || 'Unknown'} ${appointment.patientId.lastName || 'Patient'}`
      : 'Unknown Patient';
    
    const doctorName = appointment.doctorId 
      ? `Dr. ${appointment.doctorId.firstName || 'Unknown'} ${appointment.doctorId.lastName || 'Doctor'}`
      : 'Unknown Doctor';

    res.json({
      success: true,
      message: `Appointment marked as ${attended ? 'attended' : 'not attended'}`,
      data: {
        id: appointment._id,
        patientName,
        doctorName,
        date: appointment.scheduledAt.toISOString().split('T')[0],
        time: appointment.scheduledAt.toTimeString().split(' ')[0].substring(0, 5),
        status: appointment.status,
        reason: appointment.reason || 'No reason provided',
        phone: appointment.patientId?.phone || 'N/A',
        email: appointment.patientId?.email || 'N/A',
        attendedAt: appointment.attendedAt,
        markedBy: user.firstName + ' ' + user.lastName
      }
    });
  } catch (error) {
    console.error('Mark attendance error:', error);
    res.status(500).json({
      error: 'Failed to mark attendance',
      code: 'ATTENDANCE_ERROR',
      details: error.message
    });
  }
});

// Get doctor's appointments (Doctor only)
app.get('/api/doctor/appointments', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    
    // Ensure only doctors can access this route
    if (user.role !== 'doctor') {
      return res.status(403).json({
        error: 'Access denied. This route is for doctors only.',
        code: 'ACCESS_DENIED'
      });
    }
    
    // Find appointments for this specific doctor with 'waiting' status
    console.log('=== DOCTOR APPOINTMENTS DEBUG ===');
    console.log('User ID:', user.id);
    console.log('User ID type:', typeof user.id);
    console.log('ObjectId version:', new mongoose.Types.ObjectId(user.id));
    
    const appointments = await Appointment.find({ 
      doctorId: new mongoose.Types.ObjectId(user.id),
      status: 'waiting'
    })
      .populate('patientId', 'firstName lastName email phone')
      .populate('doctorId', 'firstName lastName email')
      .sort({ scheduledAt: -1 })
      .limit(100);
    
    console.log('Found appointments:', appointments.length);
    console.log('Appointments:', appointments.map(apt => ({
      id: apt._id,
      doctorId: apt.doctorId,
      status: apt.status,
      patientName: apt.patientId ? `${apt.patientId.firstName} ${apt.patientId.lastName}` : 'No patient'
    })));
    console.log('================================');
    
    const formattedAppointments = appointments.map(apt => {
      // Handle null patientId or doctorId
      const patientName = apt.patientId 
        ? `${apt.patientId.firstName || 'Unknown'} ${apt.patientId.lastName || 'Patient'}`
        : 'Unknown Patient';
      
      const doctorName = apt.doctorId 
        ? `Dr. ${apt.doctorId.firstName || 'Unknown'} ${apt.doctorId.lastName || 'Doctor'}`
        : 'Unknown Doctor';
      
      const phone = apt.patientId?.phone || 'N/A';
      const email = apt.patientId?.email || 'N/A';
      
      // Log data quality issues for debugging
      if (!apt.patientId) {
        console.warn(`Appointment ${apt._id} has null patientId`);
      }
      if (!apt.doctorId) {
        console.warn(`Appointment ${apt._id} has null doctorId`);
      }
      
      return {
        id: apt._id,
        patientName,
        doctorName,
        date: apt.scheduledAt.toISOString().split('T')[0],
        time: apt.scheduledAt.toTimeString().split(' ')[0].substring(0, 5),
        status: apt.status,
        reason: apt.reason || 'No reason provided',
        phone,
        email,
        confirmedAt: apt.confirmedAt,
        attendedAt: apt.attendedAt
      };
    });
    
    res.json({
      success: true,
      data: formattedAppointments,
      total: formattedAppointments.length,
      doctorId: user.id,
      message: `Found ${formattedAppointments.length} appointments for Dr. ${user.firstName || 'Unknown'}`
    });
  } catch (error) {
    console.error('Get doctor appointments error:', error);
    res.status(500).json({
      error: 'Failed to fetch doctor appointments',
      code: 'FETCH_ERROR',
      details: error.message
    });
  }
});

// ===========================================
// PRESCRIPTION ROUTES
// ===========================================

// Generate PDF (download only)
app.post('/api/prescriptions/generate-pdf', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    
    // Ensure only doctors can generate prescriptions
    if (user.role !== 'doctor') {
      return res.status(403).json({
        error: 'Access denied. Only doctors can generate prescriptions.',
        code: 'ACCESS_DENIED'
      });
    }

    const {
      patientName,
      patientAge,
      patientGender,
      patientPhone,
      patientEmail,
      doctorName,
      doctorQualification,
      doctorRegistration,
      clinicName,
      clinicAddress,
      clinicPhone,
      diagnosis,
      medications,
      tests,
      notes,
      whiteboardData,
      doctorSignature,
      currentDate,
      prescriptionId
    } = req.body;

    console.log('Generating PDF for prescription:', prescriptionId);

    // Create HTML content for PDF
    const htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Prescription - ${patientName}</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background: white;
          }
          .header {
            text-align: center;
            margin-bottom: 30px;
            border-bottom: 2px solid #333;
            padding-bottom: 20px;
          }
          .clinic-info {
            margin-bottom: 20px;
          }
          .patient-info {
            display: flex;
            justify-content: space-between;
            margin-bottom: 30px;
            background: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
          }
          .prescription-content {
            margin-bottom: 30px;
          }
          .whiteboard-section {
            margin: 20px 0;
            text-align: center;
          }
          .whiteboard-section img {
            max-width: 100%;
            height: auto;
            border: 1px solid #ddd;
            border-radius: 5px;
          }
          .signature-section {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            margin-top: 50px;
            padding-top: 20px;
            border-top: 1px solid #ddd;
            page-break-before: avoid;
          }
          .signature-box {
            text-align: center;
            min-width: 250px;
          }
          .signature-box img {
            max-width: 200px;
            max-height: 80px;
            object-fit: contain;
            border: 1px solid #ddd;
            padding: 5px;
          }
          .medications, .tests {
            margin: 15px 0;
          }
          .medications ul, .tests ul {
            margin: 5px 0;
            padding-left: 20px;
          }
          .diagnosis {
            font-weight: bold;
            margin: 15px 0;
            padding: 10px;
            background: #e3f2fd;
            border-left: 4px solid #2196f3;
          }
          .notes {
            margin: 15px 0;
            padding: 10px;
            background: #f5f5f5;
            border-radius: 5px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${clinicName}</h1>
          <p>${clinicAddress}</p>
          <p>Phone: ${clinicPhone}</p>
        </div>

        <div class="patient-info">
          <div>
            <h3>Patient Information</h3>
            <p><strong>Name:</strong> ${patientName}</p>
            <p><strong>Age:</strong> ${patientAge} years</p>
            <p><strong>Gender:</strong> ${patientGender}</p>
            <p><strong>Phone:</strong> ${patientPhone}</p>
            <p><strong>Email:</strong> ${patientEmail}</p>
          </div>
          <div>
            <h3>Doctor Information</h3>
            <p><strong>Name:</strong> ${doctorName}</p>
            <p><strong>Qualification:</strong> ${doctorQualification}</p>
            <p><strong>Registration:</strong> ${doctorRegistration}</p>
            <p><strong>Date:</strong> ${currentDate}</p>
          </div>
        </div>

        <div class="prescription-content">
          <div class="diagnosis">
            <strong>Diagnosis:</strong> ${diagnosis || 'Not specified'}
          </div>

          ${medications && medications.length > 0 ? `
            <div class="medications">
              <h3>Medications:</h3>
              <ul>
                ${medications.map(med => `<li>${med}</li>`).join('')}
              </ul>
            </div>
          ` : ''}

          ${tests && tests.length > 0 ? `
            <div class="tests">
              <h3>Tests Recommended:</h3>
              <ul>
                ${tests.map(test => `<li>${test}</li>`).join('')}
              </ul>
            </div>
          ` : ''}

          ${notes ? `
            <div class="notes">
              <h3>Notes:</h3>
              <p>${notes}</p>
            </div>
          ` : ''}

          ${whiteboardData ? `
            <div class="whiteboard-section">
              <h3>Prescription Details:</h3>
              <img src="${whiteboardData}" alt="Prescription Whiteboard" />
            </div>
          ` : ''}
        </div>

        <div class="signature-section">
          <div>
            <p><strong>Date:</strong> ${currentDate}</p>
            <p><strong>Time:</strong> ${new Date().toLocaleTimeString()}</p>
          </div>
          <div class="signature-box">
            <p><strong>Doctor's Signature</strong></p>
            <div style="border: 1px solid #ddd; padding: 10px; margin: 10px 0; min-height: 80px; display: flex; align-items: center; justify-content: center;">
              ${doctorSignature ? `<img src="${doctorSignature}" alt="Doctor Signature" />` : '<p style="margin: 0; color: #666;">_________________</p>'}
            </div>
            <p style="margin: 5px 0; font-weight: bold;">${doctorName}</p>
            <p style="margin: 0; color: #666;">${doctorQualification}</p>
            <p style="margin: 0; color: #666;">${doctorRegistration}</p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Generate PDF using Puppeteer
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    
    // Wait for images to load
    try {
      await page.waitForSelector('img', { timeout: 5000 });
    } catch (error) {
      console.log('No images found, continuing...');
    }
    
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20px',
        right: '20px',
        bottom: '20px',
        left: '20px'
      }
    });
    
    await browser.close();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="prescription-${patientName}-${currentDate}.pdf"`);
    res.send(pdfBuffer);

  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).json({
      error: 'Failed to generate PDF',
      code: 'PDF_GENERATION_ERROR',
      details: error.message
    });
  }
});

// Generate and save PDF to server
app.post('/api/prescriptions/generate-and-save-pdf', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    
    // Ensure only doctors can generate prescriptions
    if (user.role !== 'doctor') {
      return res.status(403).json({
        error: 'Access denied. Only doctors can generate prescriptions.',
        code: 'ACCESS_DENIED'
      });
    }

    const {
      appointmentId,
      patientId,
      patientName,
      patientAge,
      patientGender,
      patientPhone,
      patientEmail,
      doctorName,
      doctorQualification,
      doctorRegistration,
      clinicName,
      clinicAddress,
      clinicPhone,
      diagnosis,
      medications,
      tests,
      notes,
      whiteboardData,
      doctorSignature,
      currentDate
    } = req.body;

    // Debug: Log the received data
    console.log('=== PRESCRIPTION CREATION DEBUG ===');
    console.log('Received appointmentId:', appointmentId, 'type:', typeof appointmentId);
    console.log('Received patientId:', patientId, 'type:', typeof patientId);
    console.log('Received patientName:', patientName);
    console.log('================================');

    // Validate required fields - only essential ones
    if (!appointmentId) {
      return res.status(400).json({
        error: 'Missing required fields: appointmentId is required',
        code: 'MISSING_REQUIRED_FIELDS'
      });
    }

    // If patientId is not provided, try to get it from the appointment
    let finalPatientId = patientId;
    if (!finalPatientId) {
      console.log('PatientId not provided, attempting to get from appointment...');
      try {
        const appointment = await Appointment.findById(appointmentId);
        if (appointment && appointment.patientId) {
          finalPatientId = appointment.patientId;
          console.log('Found patientId from appointment:', finalPatientId);
        } else {
          console.log('No appointment found or appointment has no patientId');
        }
      } catch (error) {
        console.error('Failed to get patientId from appointment:', error);
      }
    }

    if (!finalPatientId) {
      return res.status(400).json({
        error: 'Missing required fields: patientId is required and could not be determined from appointment',
        code: 'MISSING_REQUIRED_FIELDS'
      });
    }

    // Validate and convert patientId to ObjectId
    let patientObjectId;
    try {
      patientObjectId = new mongoose.Types.ObjectId(finalPatientId);
    } catch (error) {
      console.error('Invalid patientId format:', finalPatientId);
      return res.status(400).json({
        error: 'Invalid patientId format',
        code: 'INVALID_PATIENT_ID'
      });
    }

    // Validate and convert appointmentId to ObjectId
    let appointmentObjectId;
    try {
      appointmentObjectId = new mongoose.Types.ObjectId(appointmentId);
    } catch (error) {
      console.error('Invalid appointmentId format:', appointmentId);
      return res.status(400).json({
        error: 'Invalid appointmentId format',
        code: 'INVALID_APPOINTMENT_ID'
      });
    }

    // Generate unique prescription ID
    const prescriptionId = `presc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log('Generating and saving PDF for prescription:', prescriptionId);

    // Create HTML content for PDF (same as above)
    const htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Prescription - ${patientName}</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background: white;
          }
          .header {
            text-align: center;
            margin-bottom: 30px;
            border-bottom: 2px solid #333;
            padding-bottom: 20px;
          }
          .clinic-info {
            margin-bottom: 20px;
          }
          .patient-info {
            display: flex;
            justify-content: space-between;
            margin-bottom: 30px;
            background: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
          }
          .prescription-content {
            margin-bottom: 30px;
          }
          .whiteboard-section {
            margin: 20px 0;
            text-align: center;
          }
          .whiteboard-section img {
            max-width: 100%;
            height: auto;
            border: 1px solid #ddd;
            border-radius: 5px;
          }
          .signature-section {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            margin-top: 50px;
            padding-top: 20px;
            border-top: 1px solid #ddd;
            page-break-before: avoid;
          }
          .signature-box {
            text-align: center;
            min-width: 250px;
          }
          .signature-box img {
            max-width: 200px;
            max-height: 80px;
            object-fit: contain;
            border: 1px solid #ddd;
            padding: 5px;
          }
          .medications, .tests {
            margin: 15px 0;
          }
          .medications ul, .tests ul {
            margin: 5px 0;
            padding-left: 20px;
          }
          .diagnosis {
            font-weight: bold;
            margin: 15px 0;
            padding: 10px;
            background: #e3f2fd;
            border-left: 4px solid #2196f3;
          }
          .notes {
            margin: 15px 0;
            padding: 10px;
            background: #f5f5f5;
            border-radius: 5px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${clinicName}</h1>
          <p>${clinicAddress}</p>
          <p>Phone: ${clinicPhone}</p>
        </div>

        <div class="patient-info">
          <div>
            <h3>Patient Information</h3>
            <p><strong>Name:</strong> ${patientName}</p>
            <p><strong>Age:</strong> ${patientAge} years</p>
            <p><strong>Gender:</strong> ${patientGender}</p>
            <p><strong>Phone:</strong> ${patientPhone}</p>
            <p><strong>Email:</strong> ${patientEmail}</p>
          </div>
          <div>
            <h3>Doctor Information</h3>
            <p><strong>Name:</strong> ${doctorName}</p>
            <p><strong>Qualification:</strong> ${doctorQualification}</p>
            <p><strong>Registration:</strong> ${doctorRegistration}</p>
            <p><strong>Date:</strong> ${currentDate}</p>
          </div>
        </div>

        <div class="prescription-content">
          <div class="diagnosis">
            <strong>Diagnosis:</strong> ${diagnosis || 'Not specified'}
          </div>

          ${medications && medications.length > 0 ? `
            <div class="medications">
              <h3>Medications:</h3>
              <ul>
                ${medications.map(med => `<li>${med}</li>`).join('')}
              </ul>
            </div>
          ` : ''}

          ${tests && tests.length > 0 ? `
            <div class="tests">
              <h3>Tests Recommended:</h3>
              <ul>
                ${tests.map(test => `<li>${test}</li>`).join('')}
              </ul>
            </div>
          ` : ''}

          ${notes ? `
            <div class="notes">
              <h3>Notes:</h3>
              <p>${notes}</p>
            </div>
          ` : ''}

          ${whiteboardData ? `
            <div class="whiteboard-section">
              <h3>Prescription Details:</h3>
              <img src="${whiteboardData}" alt="Prescription Whiteboard" />
            </div>
          ` : ''}
        </div>

        <div class="signature-section">
          <div>
            <p><strong>Date:</strong> ${currentDate}</p>
            <p><strong>Time:</strong> ${new Date().toLocaleTimeString()}</p>
          </div>
          <div class="signature-box">
            <p><strong>Doctor's Signature</strong></p>
            <div style="border: 1px solid #ddd; padding: 10px; margin: 10px 0; min-height: 80px; display: flex; align-items: center; justify-content: center;">
              ${doctorSignature ? `<img src="${doctorSignature}" alt="Doctor Signature" />` : '<p style="margin: 0; color: #666;">_________________</p>'}
            </div>
            <p style="margin: 5px 0; font-weight: bold;">${doctorName}</p>
            <p style="margin: 0; color: #666;">${doctorQualification}</p>
            <p style="margin: 0; color: #666;">${doctorRegistration}</p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Generate PDF using Puppeteer
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    
    // Wait for images to load
    try {
      await page.waitForSelector('img', { timeout: 5000 });
    } catch (error) {
      console.log('No images found, continuing...');
    }
    
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20px',
        right: '20px',
        bottom: '20px',
        left: '20px'
      }
    });
    
    await browser.close();

    // Create organized storage structure
    const storageDir = path.join(__dirname, '../../storage');
    const prescriptionsDir = path.join(storageDir, 'prescriptions');
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const yearMonthDir = path.join(prescriptionsDir, `${year}`, `${month}`);
    
    // Create directories if they don't exist
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    if (!fs.existsSync(prescriptionsDir)) {
      fs.mkdirSync(prescriptionsDir, { recursive: true });
    }
    if (!fs.existsSync(yearMonthDir)) {
      fs.mkdirSync(yearMonthDir, { recursive: true });
    }

    // Generate filename with better organization
    const sanitizedPatientName = patientName.replace(/[^a-zA-Z0-9]/g, '_');
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `prescription_${sanitizedPatientName}_${dateStr}_${prescriptionId}.pdf`;
    const filePath = path.join(yearMonthDir, fileName);

    // Save PDF to server
    fs.writeFileSync(filePath, pdfBuffer);

    console.log('PDF saved to:', filePath);

    // Calculate relative path for easier access
    const relativePath = path.relative(storageDir, filePath);
    
    // Create prescription record in database - only essential fields
    try {
      const prescription = new Prescription({
        prescriptionId: prescriptionId,
        appointmentId: appointmentObjectId,
        patientId: patientObjectId,
        doctorId: user.id,
        prescriptionPdf: relativePath,
        status: 'submitted'
      });

      await prescription.save();
      console.log('Created prescription record in database:', prescriptionId);
      console.log('PDF path stored:', relativePath);
    } catch (dbError) {
      console.error('Failed to create prescription in database:', dbError);
      return res.status(500).json({
        error: 'Failed to save prescription to database',
        code: 'DATABASE_ERROR',
        details: dbError.message
      });
    }
    
    res.json({
      success: true,
      message: 'Prescription PDF generated and saved successfully',
      fileName: fileName,
      filePath: filePath,
      relativePath: relativePath,
      storagePath: `storage/prescriptions/${year}/${month}/${fileName}`,
      prescriptionId: prescriptionId,
      patientName: patientName,
      doctorName: doctorName,
      generatedAt: new Date().toISOString(),
      fileSize: pdfBuffer.length
    });

  } catch (error) {
    console.error('PDF save error:', error);
    res.status(500).json({
      error: 'Failed to generate and save PDF',
      code: 'PDF_SAVE_ERROR',
      details: error.message
    });
  }
});

// ===========================================
// PRESCRIPTION RETRIEVAL ENDPOINTS
// ===========================================

// Get prescription by patient ID
app.get('/api/prescriptions/patient/:patientId', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const { patientId } = req.params;
    
    // Check if user has access (doctor, admin, receptionist, pharmacy)
    if (!['doctor', 'admin', 'receptionist', 'pharmacy', 'pharmacist'].includes(user.role)) {
      return res.status(403).json({
        error: 'Access denied. Only authorized personnel can access prescriptions.',
        code: 'ACCESS_DENIED'
      });
    }

    const prescriptions = await Prescription.find({ patientId })
      .populate('patientId', 'firstName lastName email phone')
      .populate('doctorId', 'firstName lastName email')
      .populate('appointmentId', 'appointmentId scheduledAt reason')
      .sort({ createdAt: -1 });

    const formattedPrescriptions = prescriptions.map(prescription => ({
      id: prescription._id,
      prescriptionId: prescription.prescriptionId,
      patientName: `${prescription.patientId.firstName} ${prescription.patientId.lastName}`,
      doctorName: `Dr. ${prescription.doctorId.firstName} ${prescription.doctorId.lastName}`,
      appointmentId: prescription.appointmentId?.appointmentId,
      appointmentDate: prescription.appointmentId?.scheduledAt,
      reason: prescription.appointmentId?.reason,
      diagnosis: prescription.diagnosis,
      medications: prescription.medications,
      tests: prescription.tests,
      status: prescription.status,
      prescriptionPdf: prescription.prescriptionPdf,
      createdAt: prescription.createdAt,
      updatedAt: prescription.updatedAt
    }));

    res.json({
      success: true,
      data: formattedPrescriptions,
      total: formattedPrescriptions.length
    });

  } catch (error) {
    console.error('Get prescriptions by patient error:', error);
    res.status(500).json({
      error: 'Failed to fetch prescriptions',
      code: 'FETCH_ERROR',
      details: error.message
    });
  }
});

// Get prescription by appointment ID
app.get('/api/prescriptions/appointment/:appointmentId', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const { appointmentId } = req.params;
    
    // Check if user has access
    if (!['doctor', 'admin', 'receptionist', 'pharmacy', 'pharmacist'].includes(user.role)) {
      return res.status(403).json({
        error: 'Access denied. Only authorized personnel can access prescriptions.',
        code: 'ACCESS_DENIED'
      });
    }

    const prescription = await Prescription.findOne({ appointmentId })
      .populate('patientId', 'firstName lastName email phone')
      .populate('doctorId', 'firstName lastName email')
      .populate('appointmentId', 'appointmentId scheduledAt reason');

    if (!prescription) {
      return res.status(404).json({
        error: 'Prescription not found for this appointment',
        code: 'PRESCRIPTION_NOT_FOUND'
      });
    }

    const formattedPrescription = {
      id: prescription._id,
      prescriptionId: prescription.prescriptionId,
      patientName: `${prescription.patientId.firstName} ${prescription.patientId.lastName}`,
      doctorName: `Dr. ${prescription.doctorId.firstName} ${prescription.doctorId.lastName}`,
      appointmentId: prescription.appointmentId?.appointmentId,
      appointmentDate: prescription.appointmentId?.scheduledAt,
      reason: prescription.appointmentId?.reason,
      diagnosis: prescription.diagnosis,
      medications: prescription.medications,
      tests: prescription.tests,
      status: prescription.status,
      prescriptionPdf: prescription.prescriptionPdf,
      createdAt: prescription.createdAt,
      updatedAt: prescription.updatedAt
    };

    res.json({
      success: true,
      data: formattedPrescription
    });

  } catch (error) {
    console.error('Get prescription by appointment error:', error);
    res.status(500).json({
      error: 'Failed to fetch prescription',
      code: 'FETCH_ERROR',
      details: error.message
    });
  }
});

// Serve prescription PDF file
app.get('/api/prescriptions/pdf/:prescriptionId', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const { prescriptionId } = req.params;
    
    // Check if user has access
    if (!['doctor', 'admin', 'receptionist', 'pharmacy', 'pharmacist'].includes(user.role)) {
      return res.status(403).json({
        error: 'Access denied. Only authorized personnel can access prescription files.',
        code: 'ACCESS_DENIED'
      });
    }

    // Find prescription in database
    const prescription = await Prescription.findOne({ prescriptionId });
    if (!prescription) {
      return res.status(404).json({
        error: 'Prescription not found',
        code: 'PRESCRIPTION_NOT_FOUND'
      });
    }

    if (!prescription.prescriptionPdf) {
      return res.status(404).json({
        error: 'Prescription PDF not available',
        code: 'PDF_NOT_AVAILABLE'
      });
    }

    // Construct full file path
    const filePath = path.join(__dirname, '../../storage', prescription.prescriptionPdf);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        error: 'Prescription PDF file not found on server',
        code: 'FILE_NOT_FOUND'
      });
    }

    // Set appropriate headers for PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="prescription_${prescription.prescriptionId}.pdf"`);
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    
    // Send the file
    res.sendFile(filePath);

  } catch (error) {
    console.error('Serve prescription PDF error:', error);
    res.status(500).json({
      error: 'Failed to serve prescription PDF',
      code: 'SERVE_ERROR',
      details: error.message
    });
  }
});

// Get prescriptions
app.get('/api/prescriptions', async (req, res) => {
  try {
    const prescriptions = await Prescription.find()
      .populate('patientId', 'firstName lastName email phone')
      .populate('doctorId', 'firstName lastName email')
      .populate('appointmentId', 'appointmentId scheduledAt')
      .sort({ createdAt: -1 })
      .limit(100);
    
    const formattedPrescriptions = prescriptions.map(prescription => ({
      id: prescription._id,
      prescriptionId: prescription.prescriptionId,
      patientName: `${prescription.patientId.firstName} ${prescription.patientId.lastName}`,
      doctorName: `Dr. ${prescription.doctorId.firstName} ${prescription.doctorId.lastName}`,
      date: prescription.createdAt.toISOString().split('T')[0],
      status: prescription.status,
      diagnosis: prescription.diagnosis,
      medications: prescription.medications.map(med => `${med.name} ${med.dosage} - ${med.frequency}`),
      medicationCount: prescription.medications.length,
      testCount: prescription.tests.length,
      phone: prescription.patientId.phone,
      email: prescription.patientId.email,
      appointmentId: prescription.appointmentId?.appointmentId,
      createdAt: prescription.createdAt
    }));
    
    res.json({
      success: true,
      data: formattedPrescriptions
    });
  } catch (error) {
    console.error('Get prescriptions error:', error);
    res.status(500).json({
      error: 'Failed to fetch prescriptions',
      code: 'FETCH_ERROR'
    });
  }
});

// Create prescription
app.post('/api/prescriptions', async (req, res) => {
  try {
    const { 
      patientId, 
      doctorId, 
      appointmentId, 
      diagnosis, 
      symptoms,
      medications, 
      tests, 
      notes, 
      whiteboardData,
      followUpRequired,
      followUpDate,
      followUpNotes
    } = req.body;
    
    // Validation
    if (!patientId || !doctorId || !diagnosis) {
      return res.status(400).json({
        error: 'Missing required fields',
        code: 'MISSING_FIELDS'
      });
    }
    
    // Generate prescription ID
    const prescriptionId = `RX${Date.now()}${Math.floor(Math.random() * 1000)}`;
    
    // Create prescription
    const prescription = new Prescription({
      prescriptionId,
      patientId,
      doctorId,
      appointmentId,
      diagnosis,
      symptoms: symptoms || [],
      medications: medications || [],
      tests: tests || [],
      notes,
      whiteboardData,
      followUpRequired: followUpRequired || false,
      followUpDate: followUpDate ? new Date(followUpDate) : undefined,
      followUpNotes,
      status: 'draft'
    });
    
    await prescription.save();
    
    // Populate the response
    await prescription.populate('patientId', 'firstName lastName email phone');
    await prescription.populate('doctorId', 'firstName lastName email');
    await prescription.populate('appointmentId', 'appointmentId scheduledAt');
    
    const formattedPrescription = {
      id: prescription._id,
      prescriptionId: prescription.prescriptionId,
      patientName: `${prescription.patientId.firstName} ${prescription.patientId.lastName}`,
      doctorName: `Dr. ${prescription.doctorId.firstName} ${prescription.doctorId.lastName}`,
      date: prescription.createdAt.toISOString().split('T')[0],
      status: prescription.status,
      diagnosis: prescription.diagnosis,
      medications: prescription.medications.map(med => `${med.name} ${med.dosage} - ${med.frequency}`),
      medicationCount: prescription.medications.length,
      testCount: prescription.tests.length,
      phone: prescription.patientId.phone,
      email: prescription.patientId.email,
      appointmentId: prescription.appointmentId?.appointmentId,
      createdAt: prescription.createdAt
    };
    
    res.status(201).json({
      success: true,
      message: 'Prescription created successfully',
      data: formattedPrescription
    });
  } catch (error) {
    console.error('Create prescription error:', error);
    res.status(500).json({
      error: 'Failed to create prescription',
      code: 'CREATE_ERROR'
    });
  }
});

// Get prescription by ID
app.get('/api/prescriptions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const prescription = await Prescription.findById(id)
      .populate('patientId', 'firstName lastName email phone patientInfo')
      .populate('doctorId', 'firstName lastName email doctorInfo')
      .populate('appointmentId', 'appointmentId scheduledAt reason')
      .populate('pharmacyId', 'firstName lastName email');
    
    if (!prescription) {
      return res.status(404).json({
        error: 'Prescription not found',
        code: 'PRESCRIPTION_NOT_FOUND'
      });
    }
    
    const detailedPrescription = {
      id: prescription._id,
      prescriptionId: prescription.prescriptionId,
      patient: {
        id: prescription.patientId._id,
        name: `${prescription.patientId.firstName} ${prescription.patientId.lastName}`,
        email: prescription.patientId.email,
        phone: prescription.patientId.phone,
        info: prescription.patientId.patientInfo
      },
      doctor: {
        id: prescription.doctorId._id,
        name: `Dr. ${prescription.doctorId.firstName} ${prescription.doctorId.lastName}`,
        email: prescription.doctorId.email,
        info: prescription.doctorId.doctorInfo
      },
      appointment: prescription.appointmentId ? {
        id: prescription.appointmentId._id,
        appointmentId: prescription.appointmentId.appointmentId,
        scheduledAt: prescription.appointmentId.scheduledAt,
        reason: prescription.appointmentId.reason
      } : null,
      pharmacist: prescription.pharmacyId ? {
        id: prescription.pharmacyId._id,
        name: `${prescription.pharmacyId.firstName} ${prescription.pharmacyId.lastName}`,
        email: prescription.pharmacyId.email
      } : null,
      diagnosis: prescription.diagnosis,
      symptoms: prescription.symptoms,
      medications: prescription.medications,
      tests: prescription.tests,
      whiteboardData: prescription.whiteboardData,
      prescriptionImage: prescription.prescriptionImage,
      prescriptionPdf: prescription.prescriptionPdf,
      status: prescription.status,
      followUpRequired: prescription.followUpRequired,
      followUpDate: prescription.followUpDate,
      followUpNotes: prescription.followUpNotes,
      notes: prescription.notes,
      sentToPharmacyAt: prescription.sentToPharmacyAt,
      fulfilledAt: prescription.fulfilledAt,
      createdAt: prescription.createdAt,
      updatedAt: prescription.updatedAt
    };
    
    res.json({
      success: true,
      data: detailedPrescription
    });
  } catch (error) {
    console.error('Get prescription error:', error);
    res.status(500).json({
      error: 'Failed to fetch prescription',
      code: 'FETCH_ERROR'
    });
  }
});

// Update prescription
app.patch('/api/prescriptions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    // Find and update prescription
    const prescription = await Prescription.findByIdAndUpdate(
      id,
      { ...updateData, updatedAt: new Date() },
      { new: true, runValidators: true }
    )
    .populate('patientId', 'firstName lastName email phone')
    .populate('doctorId', 'firstName lastName email')
    .populate('appointmentId', 'appointmentId scheduledAt');
    
    if (!prescription) {
      return res.status(404).json({
        error: 'Prescription not found',
        code: 'PRESCRIPTION_NOT_FOUND'
      });
    }
    
    const formattedPrescription = {
      id: prescription._id,
      prescriptionId: prescription.prescriptionId,
      patientName: `${prescription.patientId.firstName} ${prescription.patientId.lastName}`,
      doctorName: `Dr. ${prescription.doctorId.firstName} ${prescription.doctorId.lastName}`,
      date: prescription.createdAt.toISOString().split('T')[0],
      status: prescription.status,
      diagnosis: prescription.diagnosis,
      medications: prescription.medications.map(med => `${med.name} ${med.dosage} - ${med.frequency}`),
      medicationCount: prescription.medications.length,
      testCount: prescription.tests.length,
      phone: prescription.patientId.phone,
      email: prescription.patientId.email,
      appointmentId: prescription.appointmentId?.appointmentId,
      createdAt: prescription.createdAt,
      updatedAt: prescription.updatedAt
    };
    
    res.json({
      success: true,
      message: 'Prescription updated successfully',
      data: formattedPrescription
    });
  } catch (error) {
    console.error('Update prescription error:', error);
    res.status(500).json({
      error: 'Failed to update prescription',
      code: 'UPDATE_ERROR'
    });
  }
});

// ===========================================
// PHARMACY ROUTES
// ===========================================

// Get pharmacy queue
app.get('/api/pharmacy', async (req, res) => {
  try {
    // Get prescriptions that are sent to pharmacy or pending fulfillment
    const prescriptions = await Prescription.find({
      status: { $in: ['sent-to-pharmacy', 'fulfilled'] }
    })
    .populate('patientId', 'firstName lastName email phone')
    .populate('doctorId', 'firstName lastName email')
    .populate('pharmacyId', 'firstName lastName email')
    .sort({ sentToPharmacyAt: -1, createdAt: -1 })
    .limit(100);
    
    const queue = prescriptions.map(prescription => ({
      id: prescription._id,
      prescriptionId: prescription.prescriptionId,
      patientName: `${prescription.patientId.firstName} ${prescription.patientId.lastName}`,
      doctorName: `Dr. ${prescription.doctorId.firstName} ${prescription.doctorId.lastName}`,
      pharmacistName: prescription.pharmacyId ? `${prescription.pharmacyId.firstName} ${prescription.pharmacyId.lastName}` : null,
      medications: prescription.medications.map(med => `${med.name} ${med.dosage} - ${med.frequency}`),
      medicationCount: prescription.medications.length,
      status: prescription.status,
      priority: prescription.tests.some(test => test.priority === 'urgent' || test.priority === 'stat') ? 'high' : 'normal',
      sentToPharmacyAt: prescription.sentToPharmacyAt,
      fulfilledAt: prescription.fulfilledAt,
      createdAt: prescription.createdAt,
      phone: prescription.patientId.phone,
      email: prescription.patientId.email,
      diagnosis: prescription.diagnosis
    }));
    
    res.json({
      success: true,
      data: queue
    });
  } catch (error) {
    console.error('Get pharmacy queue error:', error);
    res.status(500).json({
      error: 'Failed to fetch pharmacy queue',
      code: 'FETCH_ERROR'
    });
  }
});

// Fulfill prescription
app.patch('/api/pharmacy/:id/fulfill', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, pharmacyId } = req.body;
    
    // Find prescription
    const prescription = await Prescription.findById(id);
    if (!prescription) {
      return res.status(404).json({
        error: 'Prescription not found',
        code: 'PRESCRIPTION_NOT_FOUND'
      });
    }
    
    // Update prescription status
    prescription.status = status;
    if (pharmacyId) {
      prescription.pharmacyId = pharmacyId;
    }
    if (notes) {
      prescription.notes = notes;
    }
    
    // Set timing fields based on status
    if (status === 'sent-to-pharmacy') {
      prescription.sentToPharmacyAt = new Date();
    } else if (status === 'fulfilled') {
      prescription.fulfilledAt = new Date();
    }
    
    await prescription.save();
    
    // Populate the response
    await prescription.populate('patientId', 'firstName lastName email phone');
    await prescription.populate('doctorId', 'firstName lastName email');
    await prescription.populate('pharmacyId', 'firstName lastName email');
    
    const formattedPrescription = {
      id: prescription._id,
      prescriptionId: prescription.prescriptionId,
      patientName: `${prescription.patientId.firstName} ${prescription.patientId.lastName}`,
      doctorName: `Dr. ${prescription.doctorId.firstName} ${prescription.doctorId.lastName}`,
      pharmacistName: prescription.pharmacyId ? `${prescription.pharmacyId.firstName} ${prescription.pharmacyId.lastName}` : null,
      status: prescription.status,
      sentToPharmacyAt: prescription.sentToPharmacyAt,
      fulfilledAt: prescription.fulfilledAt,
      notes: prescription.notes,
      updatedAt: prescription.updatedAt
    };
    
    res.json({
      success: true,
      message: 'Prescription fulfillment updated',
      data: formattedPrescription
    });
  } catch (error) {
    console.error('Fulfill prescription error:', error);
    res.status(500).json({
      error: 'Failed to update fulfillment',
      code: 'UPDATE_ERROR'
    });
  }
});

// ===========================================
// PDF GENERATION SERVICE
// ===========================================

// Browser pool for better performance
let browserInstance = null;

const getBrowser = async () => {
  if (!browserInstance) {
    try {
      browserInstance = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu'
        ]
      });
    } catch (error) {
      console.error('Failed to create browser pool, creating new browser:', error);
      // Fallback: create a new browser instance
      return await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ]
      });
    }
  }
  return browserInstance;
};

const generatePrescriptionPDF = async (prescriptionData) => {
  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    
    // Optimize page settings
    await page.setViewport({ width: 794, height: 1123 }); // A4 size
    await page.setCacheEnabled(false);
    
    // Generate HTML content for the prescription
    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Prescription - ${prescriptionData.patientName}</title>
      <style>
        body {
          font-family: 'Arial', sans-serif;
          margin: 0;
          padding: 20px;
          background: white;
          color: #333;
        }
        .header {
          border-bottom: 3px solid #2563eb;
          padding-bottom: 15px;
          margin-bottom: 20px;
        }
        .clinic-info {
          text-align: center;
          margin-bottom: 20px;
        }
        .clinic-name {
          font-size: 24px;
          font-weight: bold;
          color: #2563eb;
          margin-bottom: 5px;
        }
        .clinic-address {
          font-size: 12px;
          color: #666;
          margin-bottom: 5px;
        }
        .clinic-phone {
          font-size: 12px;
          color: #666;
        }
        .prescription-header {
          display: flex;
          justify-content: space-between;
          margin-bottom: 20px;
          padding: 15px;
          background: #f8fafc;
          border-radius: 8px;
        }
        .patient-info, .doctor-info {
          flex: 1;
        }
        .patient-info h3, .doctor-info h3 {
          margin: 0 0 10px 0;
          color: #1f2937;
          font-size: 16px;
        }
        .info-row {
          margin-bottom: 5px;
          font-size: 14px;
        }
        .label {
          font-weight: bold;
          color: #374151;
        }
        .prescription-date {
          text-align: right;
          font-size: 14px;
          color: #666;
          margin-bottom: 20px;
        }
        .whiteboard-container {
          border: 2px solid #e5e7eb;
          border-radius: 8px;
          margin: 20px 0;
          min-height: 600px;
          background: white;
          padding: 10px;
        }
        .whiteboard-image {
          width: 100%;
          height: auto;
          min-height: 500px;
          max-height: 800px;
          border-radius: 6px;
          object-fit: contain;
          background: white;
          border: 1px solid #e5e7eb;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        .medications-section {
          margin: 20px 0;
        }
        .section-title {
          font-size: 18px;
          font-weight: bold;
          color: #1f2937;
          margin-bottom: 10px;
          border-bottom: 2px solid #e5e7eb;
          padding-bottom: 5px;
        }
        .medication-item {
          background: #f9fafb;
          padding: 10px;
          margin: 5px 0;
          border-radius: 6px;
          border-left: 4px solid #2563eb;
        }
        .medication-name {
          font-weight: bold;
          color: #1f2937;
        }
        .medication-details {
          font-size: 14px;
          color: #6b7280;
          margin-top: 5px;
        }
        .tests-section {
          margin: 20px 0;
        }
        .test-item {
          background: #f0f9ff;
          padding: 8px 12px;
          margin: 5px 0;
          border-radius: 6px;
          border-left: 4px solid #0ea5e9;
          font-size: 14px;
        }
        .notes-section {
          margin: 20px 0;
          padding: 15px;
          background: #fef3c7;
          border-radius: 8px;
          border-left: 4px solid #f59e0b;
        }
        .notes-title {
          font-weight: bold;
          color: #92400e;
          margin-bottom: 8px;
        }
        .notes-content {
          color: #78350f;
          line-height: 1.5;
        }
        .footer {
          margin-top: 30px;
          padding-top: 15px;
          border-top: 2px solid #e5e7eb;
          text-align: center;
          font-size: 12px;
          color: #6b7280;
        }
        .signature-section {
          margin-top: 30px;
          display: flex;
          justify-content: space-between;
        }
        .signature {
          text-align: center;
          width: 200px;
        }
        .signature-line {
          border-bottom: 1px solid #333;
          margin-bottom: 5px;
          height: 20px;
        }
        .signature-label {
          font-size: 12px;
          color: #666;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="clinic-info">
          <div class="clinic-name">${prescriptionData.clinicName}</div>
          <div class="clinic-address">${prescriptionData.clinicAddress}</div>
          <div class="clinic-phone">Phone: ${prescriptionData.clinicPhone}</div>
        </div>
      </div>

      <div class="prescription-header">
        <div class="patient-info">
          <h3>Patient Information</h3>
          <div class="info-row"><span class="label">Name:</span> ${prescriptionData.patientName}</div>
          <div class="info-row"><span class="label">Age:</span> ${prescriptionData.patientAge} years</div>
          <div class="info-row"><span class="label">Gender:</span> ${prescriptionData.patientGender}</div>
          <div class="info-row"><span class="label">Phone:</span> ${prescriptionData.patientPhone}</div>
          <div class="info-row"><span class="label">Email:</span> ${prescriptionData.patientEmail}</div>
        </div>
        <div class="doctor-info">
          <h3>Doctor Information</h3>
          <div class="info-row"><span class="label">Name:</span> ${prescriptionData.doctorName}</div>
          <div class="info-row"><span class="label">Qualification:</span> ${prescriptionData.doctorQualification}</div>
          <div class="info-row"><span class="label">Registration:</span> ${prescriptionData.doctorRegistration}</div>
        </div>
      </div>

      <div class="prescription-date">
        <strong>Prescription Date:</strong> ${prescriptionData.date}
      </div>

      ${prescriptionData.whiteboardData ? `
        <div class="whiteboard-container">
          <div style="text-align: center; margin-bottom: 10px;">
            <h3 style="color: #1f2937; font-size: 16px; margin: 0;">Prescription Details</h3>
          </div>
          <img src="data:image/png;base64,${prescriptionData.whiteboardData}" alt="Prescription Whiteboard" class="whiteboard-image" />
        </div>
      ` : ''}

      ${prescriptionData.medications && prescriptionData.medications.length > 0 ? `
        <div class="medications-section">
          <div class="section-title">Medications</div>
          ${prescriptionData.medications.map(med => `
            <div class="medication-item">
              <div class="medication-name">${med.name}</div>
              <div class="medication-details">
                <strong>Dosage:</strong> ${med.dosage} | 
                <strong>Frequency:</strong> ${med.frequency} | 
                <strong>Duration:</strong> ${med.duration}
                ${med.notes ? `<br><strong>Notes:</strong> ${med.notes}` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${prescriptionData.tests && prescriptionData.tests.length > 0 ? `
        <div class="tests-section">
          <div class="section-title">Recommended Tests</div>
          ${prescriptionData.tests.map(test => `
            <div class="test-item">${test}</div>
          `).join('')}
        </div>
      ` : ''}

      ${prescriptionData.notes ? `
        <div class="notes-section">
          <div class="notes-title">Doctor's Notes</div>
          <div class="notes-content">${prescriptionData.notes}</div>
        </div>
      ` : ''}

      <div class="signature-section">
        <div class="signature">
          ${prescriptionData.doctorSignature ? `
            <div class="signature-image">
              <img src="data:image/png;base64,${prescriptionData.doctorSignature}" alt="Doctor's Signature" style="max-width: 200px; max-height: 60px; border-bottom: 1px solid #333;" />
            </div>
          ` : `
            <div class="signature-line"></div>
          `}
          <div class="signature-label">Doctor's Signature</div>
        </div>
        <div class="signature">
          <div class="signature-line"></div>
          <div class="signature-label">Date: ${prescriptionData.currentDate || prescriptionData.date}</div>
        </div>
      </div>

      <div class="footer">
        <p>This is a computer-generated prescription. Please keep this document safe.</p>
        <p>For any queries, contact: ${prescriptionData.clinicPhone}</p>
      </div>
    </body>
    </html>
    `;

    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    
    // Wait for images to load properly
    try {
      await page.waitForSelector('img', { timeout: 5000 });
    } catch (error) {
      // If no images, continue anyway
      console.log('No images found, continuing...');
    }
    
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '15px',
        right: '15px',
        bottom: '15px',
        left: '15px'
      },
      preferCSSPageSize: true,
      displayHeaderFooter: false
    });

    await page.close(); // Close page instead of browser
    
    return {
      success: true,
      pdfBuffer,
      size: pdfBuffer.length
    };
  } catch (error) {
    console.error('PDF generation error:', error);
    
    // Close page if it exists
    try {
      if (page) {
        await page.close();
      }
    } catch (closeError) {
      console.error('Error closing page:', closeError);
    }
    
    return {
      success: false,
      error: error.message
    };
  }
};

// ===========================================
// FILE UPLOAD ROUTES
// ===========================================

// Upload prescription image
app.post('/api/files/upload/prescription-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded',
        code: 'NO_FILE'
      });
    }

    const { prescriptionId } = req.body;
    if (!prescriptionId) {
      return res.status(400).json({
        error: 'Prescription ID is required',
        code: 'MISSING_PRESCRIPTION_ID'
      });
    }

    const result = await localFileStorage.savePrescriptionFile(req.file, prescriptionId, 'images');
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Prescription image uploaded successfully',
        data: {
          filename: result.filename,
          originalName: result.originalName,
          url: result.url,
          relativePath: result.relativePath,
          size: result.size,
          mimetype: result.mimetype,
          prescriptionId: result.prescriptionId,
          fileType: result.fileType,
          uploadedAt: result.uploadedAt
        }
      });
    } else {
      res.status(500).json({
        error: 'Failed to save prescription image',
        code: 'SAVE_ERROR'
      });
    }
  } catch (error) {
    console.error('Upload prescription image error:', error);
    res.status(500).json({
      error: 'Failed to upload prescription image',
      code: 'UPLOAD_ERROR'
    });
  }
});

// Upload prescription PDF
app.post('/api/files/upload/prescription-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded',
        code: 'NO_FILE'
      });
    }

    const { prescriptionId } = req.body;
    if (!prescriptionId) {
      return res.status(400).json({
        error: 'Prescription ID is required',
        code: 'MISSING_PRESCRIPTION_ID'
      });
    }

    const result = await localFileStorage.savePrescriptionFile(req.file, prescriptionId, 'pdfs');
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Prescription PDF uploaded successfully',
        data: {
          filename: result.filename,
          originalName: result.originalName,
          url: result.url,
          relativePath: result.relativePath,
          size: result.size,
          mimetype: result.mimetype,
          prescriptionId: result.prescriptionId,
          fileType: result.fileType,
          uploadedAt: result.uploadedAt
        }
      });
    } else {
      res.status(500).json({
        error: 'Failed to save prescription PDF',
        code: 'SAVE_ERROR'
      });
    }
  } catch (error) {
    console.error('Upload prescription PDF error:', error);
    res.status(500).json({
      error: 'Failed to upload prescription PDF',
      code: 'UPLOAD_ERROR'
    });
  }
});

// Get prescription files
app.get('/api/files/prescription/:prescriptionId', async (req, res) => {
  try {
    const { prescriptionId } = req.params;
    
    const result = await localFileStorage.getPrescriptionFiles(prescriptionId);
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Prescription files retrieved successfully',
        data: {
          prescriptionId,
          files: result.files,
          count: result.count
        }
      });
    } else {
      res.status(500).json({
        error: 'Failed to retrieve prescription files',
        code: 'RETRIEVE_ERROR'
      });
    }
  } catch (error) {
    console.error('Get prescription files error:', error);
    res.status(500).json({
      error: 'Failed to get prescription files',
      code: 'GET_ERROR'
    });
  }
});

// Delete prescription files
app.delete('/api/files/prescription/:prescriptionId', async (req, res) => {
  try {
    const { prescriptionId } = req.params;
    
    const result = await localFileStorage.deletePrescriptionFiles(prescriptionId);
    
    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        data: {
          prescriptionId,
          deletedCount: result.deletedCount
        }
      });
    } else {
      res.status(500).json({
        error: 'Failed to delete prescription files',
        code: 'DELETE_ERROR'
      });
    }
  } catch (error) {
    console.error('Delete prescription files error:', error);
    res.status(500).json({
      error: 'Failed to delete prescription files',
      code: 'DELETE_ERROR'
    });
  }
});


// Serve prescription files
app.get('/api/prescriptions/files/*', authenticateToken, (req, res) => {
  try {
    const user = req.user;
    
    // Ensure only doctors, admins, receptionists, and pharmacy can access prescription files
    if (!['doctor', 'admin', 'receptionist', 'pharmacy', 'pharmacist'].includes(user.role)) {
      return res.status(403).json({
        error: 'Access denied. Only authorized personnel can access prescription files.',
        code: 'ACCESS_DENIED'
      });
    }
    
    // Handle both old and new file paths
    const requestedPath = req.params[0];
    let filePath;
    
    // Check if it's a relative path (new format)
    if (requestedPath.startsWith('prescriptions/')) {
      filePath = path.join(__dirname, '../../storage', requestedPath);
    } else {
      // Legacy path format
      filePath = path.join(__dirname, '../../storage/prescriptions', requestedPath);
    }
    
    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
      res.sendFile(filePath);
    } else {
      res.status(404).json({
        error: 'Prescription file not found',
        code: 'FILE_NOT_FOUND'
      });
    }
  } catch (error) {
    console.error('Serve prescription file error:', error);
    res.status(500).json({
      error: 'Failed to serve prescription file',
      code: 'SERVE_ERROR'
    });
  }
});

// Serve uploaded files (legacy)
app.get('/uploads/prescriptions/*', (req, res) => {
  try {
    const filePath = path.join(__dirname, '../../../uploads/prescriptions', req.params[0]);
    
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).json({
        error: 'File not found',
        code: 'FILE_NOT_FOUND'
      });
    }
  } catch (error) {
    console.error('Serve file error:', error);
    res.status(500).json({
      error: 'Failed to serve file',
      code: 'SERVE_ERROR'
    });
  }
});

// Update appointment status to in-progress when doctor starts prescription
app.patch('/api/appointments/:id/start-prescription', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    // Check if user is a doctor
    if (user.role !== 'doctor') {
      return res.status(403).json({
        error: 'Only doctors can start prescriptions',
        code: 'PERMISSION_DENIED'
      });
    }

    const appointment = await Appointment.findByIdAndUpdate(
      id,
      { 
        status: 'in-progress',
        prescriptionStartedAt: new Date(),
        prescriptionStartedBy: user.id
      },
      { new: true }
    )
      .populate('patientId', 'firstName lastName email phone')
      .populate('doctorId', 'firstName lastName email');

    if (!appointment) {
      return res.status(404).json({
        error: 'Appointment not found',
        code: 'APPOINTMENT_NOT_FOUND'
      });
    }

    // Check if appointment belongs to this doctor
    if (appointment.doctorId._id.toString() !== user.id) {
      return res.status(403).json({
        error: 'You can only start prescriptions for your own appointments',
        code: 'ACCESS_DENIED'
      });
    }

    const patientName = appointment.patientId 
      ? `${appointment.patientId.firstName || 'Unknown'} ${appointment.patientId.lastName || 'Patient'}`
      : 'Unknown Patient';

    res.json({
      success: true,
      message: 'Prescription started successfully',
      data: {
        id: appointment._id,
        patientName,
        status: appointment.status,
        prescriptionStartedAt: appointment.prescriptionStartedAt,
        startedBy: user.firstName + ' ' + user.lastName
      }
    });
  } catch (error) {
    console.error('Start prescription error:', error);
    res.status(500).json({
      error: 'Failed to start prescription',
      code: 'START_PRESCRIPTION_ERROR',
      details: error.message
    });
  }
});

// Update appointment status to completed when doctor submits prescription
app.patch('/api/appointments/:id/complete-prescription', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { prescriptionId } = req.body;
    const user = req.user;

    // Check if user is a doctor
    if (user.role !== 'doctor') {
      return res.status(403).json({
        error: 'Only doctors can complete prescriptions',
        code: 'PERMISSION_DENIED'
      });
    }

    const appointment = await Appointment.findByIdAndUpdate(
      id,
      { 
        status: 'completed',
        prescriptionCompletedAt: new Date(),
        prescriptionCompletedBy: user.id,
        prescriptionId: prescriptionId
      },
      { new: true }
    )
      .populate('patientId', 'firstName lastName email phone')
      .populate('doctorId', 'firstName lastName email');

    if (!appointment) {
      return res.status(404).json({
        error: 'Appointment not found',
        code: 'APPOINTMENT_NOT_FOUND'
      });
    }

    // Check if appointment belongs to this doctor
    if (appointment.doctorId._id.toString() !== user.id) {
      return res.status(403).json({
        error: 'You can only complete prescriptions for your own appointments',
        code: 'ACCESS_DENIED'
      });
    }

    const patientName = appointment.patientId 
      ? `${appointment.patientId.firstName || 'Unknown'} ${appointment.patientId.lastName || 'Patient'}`
      : 'Unknown Patient';

    res.json({
      success: true,
      message: 'Prescription completed successfully',
      data: {
        id: appointment._id,
        patientName,
        status: appointment.status,
        prescriptionCompletedAt: appointment.prescriptionCompletedAt,
        prescriptionId: appointment.prescriptionId,
        completedBy: user.firstName + ' ' + user.lastName
      }
    });
  } catch (error) {
    console.error('Complete prescription error:', error);
    res.status(500).json({
      error: 'Failed to complete prescription',
      code: 'COMPLETE_PRESCRIPTION_ERROR',
      details: error.message
    });
  }
});

// Get appointments for pharmacy (completed appointments with prescriptions)
app.get('/api/pharmacy/appointments', authenticateToken, async (req, res) => {
  try {
    const user = req.user;

    // Check if user has pharmacy access (support both 'pharmacy' and 'pharmacist' roles)
    if (!['pharmacy', 'pharmacist', 'admin', 'receptionist'].includes(user.role)) {
      return res.status(403).json({
        error: 'Access denied. This route is for pharmacy personnel only.',
        code: 'ACCESS_DENIED'
      });
    }

    console.log('=== PHARMACY APPOINTMENTS DEBUG ===');
    console.log('User role:', user.role);
    
    // Debug: Check what users exist in the database
    const allUsers = await User.find({}, 'firstName lastName email role').limit(5);
    console.log('Sample users in database:', allUsers.map(u => ({
      id: u._id,
      name: `${u.firstName} ${u.lastName}`,
      email: u.email,
      role: u.role
    })));
    
    // Get all prescriptions from the Prescription collection
    const prescriptions = await Prescription.find({ status: 'submitted' })
      .populate('patientId', 'firstName lastName email phone role')
      .populate('doctorId', 'firstName lastName email role')
      .populate('appointmentId', 'appointmentId scheduledAt reason status')
      .sort({ createdAt: -1 })
      .limit(100);
    
    console.log('Found prescriptions:', prescriptions.length);
    console.log('Prescriptions with patient details:', prescriptions.map(pres => ({
      id: pres._id,
      prescriptionId: pres.prescriptionId,
      patientId: pres.patientId?._id,
      patientIdRaw: pres.patientId,
      patientName: pres.patientId ? `${pres.patientId.firstName} ${pres.patientId.lastName}` : 'No patient',
      patientEmail: pres.patientId?.email || 'No email',
      patientPhone: pres.patientId?.phone || 'No phone',
      patientRole: pres.patientId?.role || 'No role',
      appointmentId: pres.appointmentId?._id,
      appointmentStatus: pres.appointmentId?.status || 'No status',
      prescriptionPdf: pres.prescriptionPdf
    })));
    
    // Debug: Check if patientId is populated or just an ObjectId
    prescriptions.forEach((pres, index) => {
      console.log(`Prescription ${index + 1}:`);
      console.log(`  - patientId type: ${typeof pres.patientId}`);
      console.log(`  - patientId value: ${pres.patientId}`);
      console.log(`  - patientId is populated: ${pres.patientId && typeof pres.patientId === 'object' && pres.patientId.firstName}`);
    });
    console.log('================================');

    // Fallback: If patient details are missing, manually fetch them
    const prescriptionsWithDetails = await Promise.all(prescriptions.map(async (pres) => {
      // Check if patientId is not populated (it's just an ObjectId string)
      if (!pres.patientId || typeof pres.patientId === 'string' || !pres.patientId.firstName) {
        console.log(`Patient details missing for prescription ${pres.prescriptionId}, fetching manually...`);
        console.log(`PatientId type: ${typeof pres.patientId}, value: ${pres.patientId}`);
        try {
          // Handle both ObjectId and string cases
          const patientId = pres.patientId?._id || pres.patientId;
          console.log(`Looking up patient with ID: ${patientId}`);
          const patient = await User.findById(patientId);
          if (patient) {
            pres.patientId = patient;
            console.log(`Manually fetched patient: ${patient.firstName} ${patient.lastName}`);
          } else {
            console.log(`No patient found with ID: ${patientId}`);
            // Try to find patient by email or other fields if direct ID lookup fails
            console.log('Attempting alternative patient lookup...');
            
            // Check if the patientId exists in any form in the User collection
            const allPatients = await User.find({ role: 'patient' }, 'firstName lastName email _id');
            console.log('All patients in database:', allPatients.map(p => ({
              id: p._id,
              name: `${p.firstName} ${p.lastName}`,
              email: p.email
            })));
            
            // Try to find by string comparison (only if patientId is not null)
            if (patientId && patientId.toString() !== 'null') {
              const patientByString = allPatients.find(p => p._id.toString() === patientId.toString());
              if (patientByString) {
                console.log(`Found patient by string comparison: ${patientByString.firstName} ${patientByString.lastName}`);
                pres.patientId = patientByString;
              }
            } else {
              console.log('PatientId is null, cannot perform string comparison');
              
              // Fallback: Try to get patient from appointment data
              if (pres.appointmentId && pres.appointmentId.patientId) {
                console.log('Attempting to get patient from appointment data...');
                try {
                  const appointmentPatient = await User.findById(pres.appointmentId.patientId);
                  if (appointmentPatient) {
                    console.log(`Found patient from appointment: ${appointmentPatient.firstName} ${appointmentPatient.lastName}`);
                    pres.patientId = appointmentPatient;
                  }
                } catch (error) {
                  console.error('Failed to get patient from appointment:', error);
                }
              }
            }
          }
        } catch (error) {
          console.error(`Failed to fetch patient for prescription ${pres.prescriptionId}:`, error);
        }
      }
      return pres;
    }));

    const formattedAppointments = prescriptionsWithDetails.map(pres => {
      // Patient details with fallbacks
      const patientName = pres.patientId 
        ? `${pres.patientId.firstName || 'Unknown'} ${pres.patientId.lastName || 'Patient'}`
        : 'Unknown Patient';
      
      const patientPhone = pres.patientId?.phone || 'N/A';
      const patientEmail = pres.patientId?.email || 'N/A';
      const patientId = pres.patientId?._id || null;
      
      // Doctor details with fallbacks
      const doctorName = pres.doctorId 
        ? `Dr. ${pres.doctorId.firstName || 'Unknown'} ${pres.doctorId.lastName || 'Doctor'}`
        : 'Unknown Doctor';
      
      const doctorId = pres.doctorId?._id || null;
      
      // Appointment details with fallbacks
      const appointmentDate = pres.appointmentId?.scheduledAt 
        ? pres.appointmentId.scheduledAt.toISOString().split('T')[0] 
        : pres.createdAt.toISOString().split('T')[0];
      
      const appointmentTime = pres.appointmentId?.scheduledAt 
        ? pres.appointmentId.scheduledAt.toTimeString().split(' ')[0].substring(0, 5) 
        : pres.createdAt.toTimeString().split(' ')[0].substring(0, 5);
      
      const appointmentReason = pres.appointmentId?.reason || 'No reason provided';
      const appointmentId = pres.appointmentId?._id || null;

      return {
        id: appointmentId || pres._id, // Use appointment ID if available, otherwise prescription ID
        prescriptionId: pres.prescriptionId,
        patientId,
        patientName,
        patientPhone,
        patientEmail,
        doctorId,
        doctorName,
        appointmentId,
        date: appointmentDate,
        time: appointmentTime,
        status: 'completed',
        reason: appointmentReason,
        phone: patientPhone,
        email: patientEmail,
        prescriptionCompletedAt: pres.createdAt,
        completedBy: doctorName,
        prescriptionPdf: pres.prescriptionPdf,
        // Additional metadata
        prescriptionStatus: pres.status,
        createdAt: pres.createdAt,
        updatedAt: pres.updatedAt
      };
    });
    
    res.json({
      success: true,
      data: formattedAppointments,
      total: formattedAppointments.length,
      message: `Found ${formattedAppointments.length} completed appointments with prescriptions`
    });
  } catch (error) {
    console.error('Get pharmacy appointments error:', error);
    res.status(500).json({
      error: 'Failed to fetch pharmacy appointments',
      code: 'FETCH_ERROR',
      details: error.message
    });
  }
});

// ===========================================
// PHARMACY WORKFLOW ENDPOINTS
// ===========================================

// Create pharmacy order from completed appointment
app.post('/api/pharmacy/orders', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    
    // Check if user has pharmacy access
    if (!['pharmacy', 'pharmacist', 'admin', 'receptionist'].includes(user.role)) {
      return res.status(403).json({
        error: 'Access denied. This route is for pharmacy personnel only.',
        code: 'ACCESS_DENIED'
      });
    }

    const { appointmentId, prescriptionId } = req.body;

    if (!appointmentId || !prescriptionId) {
      return res.status(400).json({
        error: 'Appointment ID and Prescription ID are required',
        code: 'MISSING_REQUIRED_FIELDS'
      });
    }

    // Find the appointment and prescription
    const appointment = await Appointment.findById(appointmentId)
      .populate('patientId', 'firstName lastName email phone')
      .populate('doctorId', 'firstName lastName email');
    
    const prescription = await Prescription.findById(prescriptionId);

    if (!appointment || !prescription) {
      return res.status(404).json({
        error: 'Appointment or prescription not found',
        code: 'NOT_FOUND'
      });
    }

    // Check if order already exists
    const existingOrder = await PharmacyOrder.findOne({ 
      appointmentId: appointmentId,
      prescriptionId: prescriptionId 
    });

    if (existingOrder) {
      return res.status(400).json({
        error: 'Pharmacy order already exists for this appointment',
        code: 'ORDER_EXISTS'
      });
    }

    // Generate order ID
    const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;

    // Create pharmacy order
    const pharmacyOrder = new PharmacyOrder({
      orderId,
      appointmentId: appointment._id,
      prescriptionId: prescription._id,
      patientId: appointment.patientId._id,
      doctorId: appointment.doctorId._id,
      pharmacyId: user.id,
      medications: prescription.medications.map(med => ({
        name: med.name,
        genericName: med.genericName,
        dosage: med.dosage,
        frequency: med.frequency,
        duration: med.duration,
        quantity: med.quantity,
        unit: med.unit,
        instructions: med.instructions
      })),
      status: 'pending',
      receivedAt: new Date()
    });

    await pharmacyOrder.save();

    // Update prescription status
    prescription.status = 'sent-to-pharmacy';
    prescription.sentToPharmacyAt = new Date();
    prescription.pharmacyId = user.id;
    await prescription.save();

    res.json({
      success: true,
      message: 'Pharmacy order created successfully',
      data: {
        orderId: pharmacyOrder.orderId,
        id: pharmacyOrder._id,
        patientName: `${appointment.patientId.firstName} ${appointment.patientId.lastName}`,
        doctorName: `Dr. ${appointment.doctorId.firstName} ${appointment.doctorId.lastName}`,
        status: pharmacyOrder.status,
        medications: pharmacyOrder.medications.length,
        receivedAt: pharmacyOrder.receivedAt
      }
    });

  } catch (error) {
    console.error('Create pharmacy order error:', error);
    res.status(500).json({
      error: 'Failed to create pharmacy order',
      code: 'CREATE_ERROR',
      details: error.message
    });
  }
});

// Get pharmacy orders
app.get('/api/pharmacy/orders', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    
    // Check if user has pharmacy access
    if (!['pharmacy', 'pharmacist', 'admin', 'receptionist'].includes(user.role)) {
      return res.status(403).json({
        error: 'Access denied. This route is for pharmacy personnel only.',
        code: 'ACCESS_DENIED'
      });
    }

    const { status, customerStatus } = req.query;
    
    let query = {};
    if (status) query.status = status;
    if (customerStatus) query.customerStatus = customerStatus;

    const orders = await PharmacyOrder.find(query)
      .populate('patientId', 'firstName lastName email phone')
      .populate('doctorId', 'firstName lastName email')
      .populate('appointmentId', 'appointmentId scheduledAt reason')
      .sort({ createdAt: -1 })
      .limit(100);

    const formattedOrders = orders.map(order => ({
      id: order._id,
      orderId: order.orderId,
      patientName: `${order.patientId.firstName} ${order.patientId.lastName}`,
      doctorName: `Dr. ${order.doctorId.firstName} ${order.doctorId.lastName}`,
      appointmentId: order.appointmentId?.appointmentId,
      appointmentDate: order.appointmentId?.scheduledAt,
      reason: order.appointmentId?.reason,
      status: order.status,
      customerStatus: order.customerStatus,
      medications: order.medications.length,
      suppliedMedications: order.getSuppliedMedications().length,
      pendingMedications: order.getPendingMedications().length,
      receivedAt: order.receivedAt,
      processedAt: order.processedAt,
      readyAt: order.readyAt,
      dispensedAt: order.dispensedAt,
      phone: order.patientId.phone,
      email: order.patientId.email
    }));

    res.json({
      success: true,
      data: formattedOrders,
      total: formattedOrders.length
    });

  } catch (error) {
    console.error('Get pharmacy orders error:', error);
    res.status(500).json({
      error: 'Failed to fetch pharmacy orders',
      code: 'FETCH_ERROR',
      details: error.message
    });
  }
});

// Update pharmacy order status
app.patch('/api/pharmacy/orders/:id/status', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    
    // Check if user has pharmacy access
    if (!['pharmacy', 'pharmacist', 'admin', 'receptionist'].includes(user.role)) {
      return res.status(403).json({
        error: 'Access denied. This route is for pharmacy personnel only.',
        code: 'ACCESS_DENIED'
      });
    }

    const { id } = req.params;
    const { status, notes } = req.body;

    if (!status) {
      return res.status(400).json({
        error: 'Status is required',
        code: 'MISSING_STATUS'
      });
    }

    const order = await PharmacyOrder.findById(id);
    if (!order) {
      return res.status(404).json({
        error: 'Pharmacy order not found',
        code: 'ORDER_NOT_FOUND'
      });
    }

    await order.updateStatus(status);
    
    if (notes) {
      order.pharmacyNotes = notes;
      await order.save();
    }

    res.json({
      success: true,
      message: 'Pharmacy order status updated successfully',
      data: {
        orderId: order.orderId,
        status: order.status,
        updatedAt: order.updatedAt
      }
    });

  } catch (error) {
    console.error('Update pharmacy order status error:', error);
    res.status(500).json({
      error: 'Failed to update pharmacy order status',
      code: 'UPDATE_ERROR',
      details: error.message
    });
  }
});

// Supply medication
app.patch('/api/pharmacy/orders/:id/medications/:medIndex/supply', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    
    // Check if user has pharmacy access
    if (!['pharmacy', 'pharmacist', 'admin', 'receptionist'].includes(user.role)) {
      return res.status(403).json({
        error: 'Access denied. This route is for pharmacy personnel only.',
        code: 'ACCESS_DENIED'
      });
    }

    const { id, medIndex } = req.params;
    const { quantity, notes } = req.body;

    const order = await PharmacyOrder.findById(id);
    if (!order) {
      return res.status(404).json({
        error: 'Pharmacy order not found',
        code: 'ORDER_NOT_FOUND'
      });
    }

    const medicationIndex = parseInt(medIndex);
    if (medicationIndex < 0 || medicationIndex >= order.medications.length) {
      return res.status(400).json({
        error: 'Invalid medication index',
        code: 'INVALID_MEDICATION_INDEX'
      });
    }

    await order.supplyMedication(medicationIndex, quantity, notes);

    res.json({
      success: true,
      message: 'Medication supplied successfully',
      data: {
        orderId: order.orderId,
        medication: order.medications[medicationIndex],
        suppliedMedications: order.getSuppliedMedications().length,
        pendingMedications: order.getPendingMedications().length
      }
    });

  } catch (error) {
    console.error('Supply medication error:', error);
    res.status(500).json({
      error: 'Failed to supply medication',
      code: 'SUPPLY_ERROR',
      details: error.message
    });
  }
});

// Update customer status
app.patch('/api/pharmacy/orders/:id/customer-status', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    
    // Check if user has pharmacy access
    if (!['pharmacy', 'pharmacist', 'admin', 'receptionist'].includes(user.role)) {
      return res.status(403).json({
        error: 'Access denied. This route is for pharmacy personnel only.',
        code: 'ACCESS_DENIED'
      });
    }

    const { id } = req.params;
    const { customerStatus, reason, notes } = req.body;

    if (!customerStatus) {
      return res.status(400).json({
        error: 'Customer status is required',
        code: 'MISSING_CUSTOMER_STATUS'
      });
    }

    const order = await PharmacyOrder.findById(id);
    if (!order) {
      return res.status(404).json({
        error: 'Pharmacy order not found',
        code: 'ORDER_NOT_FOUND'
      });
    }

    await order.updateCustomerStatus(customerStatus, reason);
    
    if (notes) {
      order.customerNotes = notes;
      await order.save();
    }

    res.json({
      success: true,
      message: 'Customer status updated successfully',
      data: {
        orderId: order.orderId,
        customerStatus: order.customerStatus,
        updatedAt: order.updatedAt
      }
    });

  } catch (error) {
    console.error('Update customer status error:', error);
    res.status(500).json({
      error: 'Failed to update customer status',
      code: 'UPDATE_ERROR',
      details: error.message
    });
  }
});

// ===========================================
// ANALYTICS ROUTES
// ===========================================

// Get dashboard analytics
app.get('/api/analytics/dashboard', async (req, res) => {
  try {
    // Get real data from database
    const totalPatients = await User.countDocuments({ role: 'patient' });
    const totalAppointments = await Appointment.countDocuments();
    const totalPrescriptions = await Prescription.countDocuments();
    
    // Calculate revenue (assuming average consultation fee)
    const appointments = await Appointment.find({ status: 'completed' });
    const revenue = appointments.reduce((sum, apt) => sum + (apt.consultationFee || 500), 0);
    
    // Get appointments by day for the last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const appointmentsByDay = await Appointment.aggregate([
      {
        $match: {
          scheduledAt: { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: { $dayOfWeek: '$scheduledAt' },
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          day: {
            $switch: {
              branches: [
                { case: { $eq: ['$_id', 1] }, then: 'Sun' },
                { case: { $eq: ['$_id', 2] }, then: 'Mon' },
                { case: { $eq: ['$_id', 3] }, then: 'Tue' },
                { case: { $eq: ['$_id', 4] }, then: 'Wed' },
                { case: { $eq: ['$_id', 5] }, then: 'Thu' },
                { case: { $eq: ['$_id', 6] }, then: 'Fri' },
                { case: { $eq: ['$_id', 7] }, then: 'Sat' }
              ],
              default: 'Unknown'
            }
          },
          count: 1
        }
      }
    ]);
    
    // Get revenue by month for the last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const revenueByMonth = await Appointment.aggregate([
      {
        $match: {
          scheduledAt: { $gte: sixMonthsAgo },
          status: 'completed'
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$scheduledAt' },
            month: { $month: '$scheduledAt' }
          },
          revenue: { $sum: '$consultationFee' }
        }
      },
      {
        $project: {
          month: {
            $switch: {
              branches: [
                { case: { $eq: ['$_id.month', 1] }, then: 'Jan' },
                { case: { $eq: ['$_id.month', 2] }, then: 'Feb' },
                { case: { $eq: ['$_id.month', 3] }, then: 'Mar' },
                { case: { $eq: ['$_id.month', 4] }, then: 'Apr' },
                { case: { $eq: ['$_id.month', 5] }, then: 'May' },
                { case: { $eq: ['$_id.month', 6] }, then: 'Jun' },
                { case: { $eq: ['$_id.month', 7] }, then: 'Jul' },
                { case: { $eq: ['$_id.month', 8] }, then: 'Aug' },
                { case: { $eq: ['$_id.month', 9] }, then: 'Sep' },
                { case: { $eq: ['$_id.month', 10] }, then: 'Oct' },
                { case: { $eq: ['$_id.month', 11] }, then: 'Nov' },
                { case: { $eq: ['$_id.month', 12] }, then: 'Dec' }
              ],
              default: 'Unknown'
            }
          },
          revenue: 1
        }
      }
    ]);
    
    // Get appointment status distribution
    const appointmentStatusData = await Appointment.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          status: '$_id',
          count: 1
        }
      }
    ]);

    // Get doctor performance data
    const doctorPerformance = await Appointment.aggregate([
      {
        $lookup: {
          from: 'users',
          localField: 'doctorId',
          foreignField: '_id',
          as: 'doctor'
        }
      },
      {
        $unwind: '$doctor'
      },
      {
        $group: {
          _id: '$doctorId',
          name: { $first: { $concat: ['Dr. ', '$doctor.firstName', ' ', '$doctor.lastName'] } },
          appointments: { $sum: 1 },
          revenue: { $sum: { $ifNull: ['$consultationFee', 500] } },
          specialty: { $first: '$doctor.specialization' }
        }
      },
      {
        $sort: { appointments: -1 }
      },
      {
        $limit: 10
      }
    ]);

    // Get patient age distribution (mock data for now since we don't have age field)
    const patientAgeGroups = [
      { ageGroup: '0-18', count: Math.floor(totalPatients * 0.18) },
      { ageGroup: '19-35', count: Math.floor(totalPatients * 0.34) },
      { ageGroup: '36-50', count: Math.floor(totalPatients * 0.28) },
      { ageGroup: '51-65', count: Math.floor(totalPatients * 0.14) },
      { ageGroup: '65+', count: Math.floor(totalPatients * 0.06) }
    ];

    // Get monthly trends (patients and appointments)
    const monthlyTrends = await Appointment.aggregate([
      {
        $match: {
          scheduledAt: { $gte: sixMonthsAgo }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$scheduledAt' },
            month: { $month: '$scheduledAt' }
          },
          appointments: { $sum: 1 },
          uniquePatients: { $addToSet: '$patientId' }
        }
      },
      {
        $project: {
          month: {
            $switch: {
              branches: [
                { case: { $eq: ['$_id.month', 1] }, then: 'Jan' },
                { case: { $eq: ['$_id.month', 2] }, then: 'Feb' },
                { case: { $eq: ['$_id.month', 3] }, then: 'Mar' },
                { case: { $eq: ['$_id.month', 4] }, then: 'Apr' },
                { case: { $eq: ['$_id.month', 5] }, then: 'May' },
                { case: { $eq: ['$_id.month', 6] }, then: 'Jun' },
                { case: { $eq: ['$_id.month', 7] }, then: 'Jul' },
                { case: { $eq: ['$_id.month', 8] }, then: 'Aug' },
                { case: { $eq: ['$_id.month', 9] }, then: 'Sep' },
                { case: { $eq: ['$_id.month', 10] }, then: 'Oct' },
                { case: { $eq: ['$_id.month', 11] }, then: 'Nov' },
                { case: { $eq: ['$_id.month', 12] }, then: 'Dec' }
              ],
              default: 'Unknown'
            }
          },
          appointments: 1,
          patients: { $size: '$uniquePatients' }
        }
      }
    ]);

    // Calculate appointment status percentages
    const totalAppointmentsForStatus = appointmentStatusData.reduce((sum, item) => sum + item.count, 0);
    const appointmentStatusWithPercentages = appointmentStatusData.map(item => ({
      name: item.status.charAt(0).toUpperCase() + item.status.slice(1),
      value: totalAppointmentsForStatus > 0 ? Math.round((item.count / totalAppointmentsForStatus) * 100) : 0,
      count: item.count
    }));
    
    const analytics = {
      totalPatients,
      totalAppointments,
      totalPrescriptions,
      revenue,
      charts: {
        appointmentsByDay: appointmentsByDay.length > 0 ? appointmentsByDay : [
          { day: 'Mon', count: 0 },
          { day: 'Tue', count: 0 },
          { day: 'Wed', count: 0 },
          { day: 'Thu', count: 0 },
          { day: 'Fri', count: 0 },
          { day: 'Sat', count: 0 },
          { day: 'Sun', count: 0 }
        ],
        revenueByMonth: revenueByMonth.length > 0 ? revenueByMonth : [
          { month: 'Jan', revenue: 0 },
          { month: 'Feb', revenue: 0 },
          { month: 'Mar', revenue: 0 },
          { month: 'Apr', revenue: 0 },
          { month: 'May', revenue: 0 },
          { month: 'Jun', revenue: 0 }
        ],
        appointmentStatusData: appointmentStatusWithPercentages,
        doctorPerformance: doctorPerformance,
        patientAgeGroups: patientAgeGroups,
        monthlyTrends: monthlyTrends
      }
    };
    
    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({
      error: 'Failed to fetch analytics',
      code: 'FETCH_ERROR'
    });
  }
});

// ===========================================
// DOCTOR ROUTES
// ===========================================

// Get all doctors
app.get('/api/doctors', async (req, res) => {
  try {
    const doctors = await User.find({ role: 'doctor', isActive: true })
      .select('firstName lastName email doctorInfo')
      .sort({ firstName: 1 });
    
    const formattedDoctors = doctors.map(doctor => ({
      id: doctor._id,
      name: `Dr. ${doctor.firstName} ${doctor.lastName}`,
      email: doctor.email,
      specialty: doctor.doctorInfo?.specialization?.[0] || 'General Medicine',
      experience: doctor.doctorInfo?.experience || 0,
      qualification: doctor.doctorInfo?.qualification || '',
      consultationFee: doctor.doctorInfo?.consultationFee || 500,
      rating: 4.8 // Default rating, can be calculated from reviews later
    }));
    
    res.json({
      success: true,
      data: formattedDoctors
    });
  } catch (error) {
    console.error('Get doctors error:', error);
    res.status(500).json({
      error: 'Failed to fetch doctors',
      code: 'FETCH_ERROR'
    });
  }
});

// ===========================================
// USER MANAGEMENT ROUTES (Admin only)
// ===========================================

// Create new doctor account
app.post('/api/admin/doctors', async (req, res) => {
  try {
    console.log('Clinic Service: Doctor creation request received');
    console.log('Request body:', req.body);
    console.log('Request headers:', req.headers);
    
    const { 
      firstName, 
      lastName, 
      email, 
      phone, 
      qualification, 
      specialization, 
      experience, 
      licenseNumber, 
      consultationFee 
    } = req.body;
    
    console.log('Creating doctor with data:', { firstName, lastName, email, phone });
    
    // Validation
    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({
        error: 'Missing required fields',
        code: 'MISSING_FIELDS'
      });
    }
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        error: 'User already exists',
        code: 'USER_EXISTS'
      });
    }
    
    // Hash the password
    const bcrypt = require('bcryptjs');
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const hashedPassword = await bcrypt.hash('doctor123', saltRounds);
    
    // Create doctor
    const doctor = new User({
      firstName,
      lastName,
      email,
      phone,
      role: 'doctor',
      password: hashedPassword,
      isActive: true,
      doctorInfo: {
        qualification: qualification || '',
        specialization: Array.isArray(specialization) ? specialization : (specialization ? [specialization] : ['General Medicine']),
        licenseNumber: licenseNumber || '',
        experience: experience || 0,
        consultationFee: consultationFee || 500
      }
    });
    
    console.log('Saving doctor to database...');
    await doctor.save();
    console.log('Doctor saved successfully');
    
    // Remove password from response
    const doctorResponse = doctor.toObject();
    delete doctorResponse.password;
    
    res.status(201).json({
      success: true,
      message: 'Doctor account created successfully',
      data: doctorResponse
    });
  } catch (error) {
    console.error('Create doctor error:', error);
    res.status(500).json({
      error: 'Failed to create doctor account',
      code: 'CREATE_ERROR'
    });
  }
});

// Create new receptionist account
app.post('/api/admin/receptionists', async (req, res) => {
  try {
    const { firstName, lastName, email, phone } = req.body;
    
    console.log('Creating receptionist with data:', { firstName, lastName, email, phone });
    
    // Validation
    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({
        error: 'Missing required fields',
        code: 'MISSING_FIELDS'
      });
    }
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        error: 'User already exists',
        code: 'USER_EXISTS'
      });
    }
    
    // Hash the password
    const bcrypt = require('bcryptjs');
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const hashedPassword = await bcrypt.hash('doctor123', saltRounds);
    
    // Create receptionist
    const receptionist = new User({
      firstName,
      lastName,
      email,
      phone,
      role: 'receptionist',
      password: hashedPassword,
      isActive: true
    });
    
    console.log('Saving receptionist to database...');
    await receptionist.save();
    console.log('Receptionist saved successfully');
    
    // Remove password from response
    const receptionistResponse = receptionist.toObject();
    delete receptionistResponse.password;
    
    res.status(201).json({
      success: true,
      message: 'Receptionist account created successfully',
      data: receptionistResponse
    });
  } catch (error) {
    console.error('Create receptionist error:', error);
    res.status(500).json({
      error: 'Failed to create receptionist account',
      code: 'CREATE_ERROR'
    });
  }
});

// ===========================================
// PATIENT ROUTES
// ===========================================

// Get all patients
app.get('/api/patients', async (req, res) => {
  try {
    const patients = await User.find({ role: 'patient' })
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(100);
    
    res.json({
      success: true,
      data: patients
    });
  } catch (error) {
    console.error('Get patients error:', error);
    res.status(500).json({
      error: 'Failed to fetch patients',
      code: 'FETCH_ERROR'
    });
  }
});

// Get patient by ID
app.get('/api/patients/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const patient = await User.findOne({ _id: id, role: 'patient' })
      .select('-password');
    
    if (!patient) {
      return res.status(404).json({
        error: 'Patient not found',
        code: 'PATIENT_NOT_FOUND'
      });
    }
    
    res.json({
      success: true,
      data: patient
    });
  } catch (error) {
    console.error('Get patient error:', error);
    res.status(500).json({
      error: 'Failed to fetch patient',
      code: 'FETCH_ERROR'
    });
  }
});

// Create new patient
app.post('/api/patients', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, dateOfBirth, gender, address } = req.body;
    
    // Validation
    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({
        error: 'Missing required fields',
        code: 'MISSING_FIELDS'
      });
    }
    
    // Check if patient already exists
    const existingPatient = await User.findOne({ email, role: 'patient' });
    if (existingPatient) {
      return res.status(409).json({
        error: 'Patient already exists',
        code: 'PATIENT_EXISTS'
      });
    }
    
    // Create patient
    const patient = new User({
      firstName,
      lastName,
      email,
      phone,
      role: 'patient',
      password: 'temp123', // Will be changed on first login
      isActive: true,
      patientInfo: {
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
        gender,
        address: address ? {
          street: address.street || '',
          city: address.city || '',
          state: address.state || '',
          zipCode: address.zipCode || '',
          country: address.country || 'India'
        } : undefined
      }
    });
    
    await patient.save();
    
    // Remove password from response
    const patientResponse = patient.toObject();
    delete patientResponse.password;
    
    res.status(201).json({
      success: true,
      message: 'Patient created successfully',
      data: patientResponse
    });
  } catch (error) {
    console.error('Create patient error:', error);
    res.status(500).json({
      error: 'Failed to create patient',
      code: 'CREATE_ERROR'
    });
  }
});

// Update patient
app.patch('/api/patients/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    // Remove password from update data
    delete updateData.password;
    
    const patient = await User.findOneAndUpdate(
      { _id: id, role: 'patient' },
      updateData,
      { new: true, select: '-password' }
    );
    
    if (!patient) {
      return res.status(404).json({
        error: 'Patient not found',
        code: 'PATIENT_NOT_FOUND'
      });
    }
    
    res.json({
      success: true,
      message: 'Patient updated successfully',
      data: patient
    });
  } catch (error) {
    console.error('Update patient error:', error);
    res.status(500).json({
      error: 'Failed to update patient',
      code: 'UPDATE_ERROR'
    });
  }
});

// Delete patient
app.delete('/api/patients/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await Appointment.deleteMany({ patientId: id });
    const patient = await User.findOneAndDelete({ _id: id, role: 'patient' });
    
    if (!patient) {
      return res.status(404).json({
        error: 'Patient not found',
        code: 'PATIENT_NOT_FOUND'
      });
    }
    
    res.json({
      success: true,
      message: 'Patient deleted successfully'
    });
  } catch (error) {
    console.error('Delete patient error:', error);
    res.status(500).json({
      error: 'Failed to delete patient',
      code: 'DELETE_ERROR'
    });
  }
});

// ===========================================
// NOTIFICATION ROUTES
// ===========================================

// Send notification
app.post('/api/notifications', async (req, res) => {
  try {
    const { type, recipient, message, data } = req.body;
    
    // Mock notification sending
    res.json({
      success: true,
      message: 'Notification sent successfully',
      data: { type, recipient, message }
    });
  } catch (error) {
    console.error('Send notification error:', error);
    res.status(500).json({
      error: 'Failed to send notification',
      code: 'SEND_ERROR'
    });
  }
});

// ===========================================
// HEALTH CHECK
// ===========================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Clinic Service',
    version: '1.0.0'
  });
});

// ===========================================
// ERROR HANDLING
// ===========================================

app.use((err, req, res, next) => {
  console.error('Clinic service error:', err);
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR'
  });
});

app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    code: 'NOT_FOUND'
  });
});

// ===========================================
// START SERVER
// ===========================================

app.listen(PORT, () => {
  console.log(`🏥 Clinic Service running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
});

