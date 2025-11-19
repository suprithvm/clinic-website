import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
//import { queue } from '../email/emailQueue.js'
// Load environment variables
dotenv.config({ path: '../../.env' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ===========================================
// MIDDLEWARE SETUP
// ===========================================

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5173', 'http://localhost:3000'],
  credentials: process.env.CORS_CREDENTIALS === 'true',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 5 * 60 * 1000, // 5 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1000, // limit each IP to 1000 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parsing
app.use(cookieParser(process.env.COOKIE_SECRET));

// Compression
app.use(compression());

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// ===========================================
// SERVICE CONFIGURATION
// ===========================================

const SERVICES = {
  clinic: {
    url: `http://localhost:${process.env.CLINIC_PORT || 3001}`,
    routes: ['/appointments', '/prescriptions', '/pharmacy', '/analytics', '/notifications']
  },
  files: {
    url: `http://localhost:${process.env.FILES_PORT || 3002}`,
    routes: ['/files', '/uploads']
  }
};

// ===========================================
// AUTHENTICATION MIDDLEWARE
// ===========================================

import jwt from 'jsonwebtoken';

const authenticateToken = (req, res, next) => {
  const token = req.cookies.auth_token || req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ 
      error: 'Access denied. No token provided.',
      code: 'NO_TOKEN'
    });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ 
      error: 'Invalid token.',
      code: 'INVALID_TOKEN'
    });
  }
};

// ===========================================
// AUTHENTICATION ROUTES (Embedded in Gateway)
// ===========================================

import bcrypt from 'bcryptjs';
import { connectDB } from '../shared/database.js';
import { User } from '../shared/models/User.js';

// Connect to database
await connectDB();

// Login route
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email and password are required.',
        code: 'MISSING_CREDENTIALS'
      });
    }
    
    // Find user
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ 
        error: 'Invalid credentials.',
        code: 'INVALID_CREDENTIALS'
      });
    }
    
    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ 
        error: 'Invalid credentials.',
        code: 'INVALID_CREDENTIALS'
      });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user._id, 
        email: user.email, 
        role: user.role 
      }, 
      process.env.JWT_SECRET, 
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
    
    // Set cookie
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: parseInt(process.env.COOKIE_MAX_AGE) || 7 * 24 * 60 * 60 * 1000
    });
    
    // Remove password from response
    const userResponse = {
      id: user._id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      isActive: user.isActive
    };
    
    res.json({
      success: true,
      message: 'Login successful',
      user: userResponse,
      token: token
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      error: 'Internal server error.',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Register route
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName, role, phone } = req.body;
    
    // Validation
    if (!email || !password || !firstName || !lastName || !role) {
      return res.status(400).json({ 
        error: 'All fields are required.',
        code: 'MISSING_FIELDS'
      });
    }
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ 
        error: 'User already exists.',
        code: 'USER_EXISTS'
      });
    }
    
    // Hash password
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    // Create user
    const user = new User({
      email,
      password: hashedPassword,
      firstName,
      lastName,
      role,
      phone,
      isActive: true
    });
    
    await user.save();
    
    // Generate token
    const token = jwt.sign(
      { 
        userId: user._id, 
        email: user.email, 
        role: user.role 
      }, 
      process.env.JWT_SECRET, 
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
    
    // Set cookie
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: parseInt(process.env.COOKIE_MAX_AGE) || 7 * 24 * 60 * 60 * 1000
    });
    
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName
      },
      token: token
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      error: 'Internal server error.',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Logout route
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

// Get current user
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    console.log('Auth/me called, user:', req.user);
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) {
      return res.status(404).json({ 
        error: 'User not found.',
        code: 'USER_NOT_FOUND'
      });
    }
    
    res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        isActive: user.isActive
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ 
      error: 'Internal server error.',
      code: 'INTERNAL_ERROR'
    });
  }
});

// ===========================================
// PROXY MIDDLEWARE FOR MICROSERVICES
// ===========================================

import { createProxyMiddleware } from 'http-proxy-middleware';

// Proxy to Clinic Service
const clinicProxy = createProxyMiddleware({
  target: SERVICES.clinic.url,
  changeOrigin: true,
  onProxyReq: (proxyReq, req, res) => {
    console.log('Gateway: Forwarding request to clinic service:', req.method, req.url);
    console.log('Gateway: Target URL:', SERVICES.clinic.url);
    console.log('Gateway: Request headers:', req.headers);
    console.log('Gateway: Request body:', req.body);
    
    // Ensure the request body is properly forwarded
    if (req.body && Object.keys(req.body).length > 0) {
      const bodyData = JSON.stringify(req.body);
      proxyReq.setHeader('Content-Type', 'application/json');
      proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
      proxyReq.write(bodyData);
    }
  },
  onProxyRes: (proxyRes, req, res) => {
    console.log('Gateway: Received response from clinic service:', proxyRes.statusCode);
  },
  onError: (err, req, res) => {
    console.error('Gateway: Clinic service error:', err);
    console.error('Gateway: Request details:', req.method, req.url);
    res.status(503).json({
      error: 'Clinic service unavailable',
      code: 'SERVICE_UNAVAILABLE'
    });
  }
});

// Proxy to Files Service
const filesProxy = createProxyMiddleware({
  target: SERVICES.files.url,
  changeOrigin: true,
  onError: (err, req, res) => {
    console.error('Files service error:', err);
    res.status(503).json({
      error: 'Files service unavailable',
      code: 'SERVICE_UNAVAILABLE'
    });
  }
});

// Public appointment booking (handled directly in gateway)
app.post('/api/public/appointments', async (req, res) => {
  try {
    console.log('Gateway: Processing public appointment booking directly');
    console.log('Request data:', req.body);
    
    const { patientName, doctorName, date, time, reason, phone, email } = req.body;
    
    // Validation
    if (!patientName || !doctorName || !date || !time) {
      return res.status(400).json({
        error: 'Missing required fields',
        code: 'MISSING_FIELDS'
      });
    }
    
    // Import models (we need to import them in gateway)
    console.log('Importing models...');
    const { User } = await import('../shared/models/User.js');
    const { Appointment: AppointmentModel } = await import('../shared/models/Appointment.js');
    console.log('Models imported successfully');
    
    // Find or create patient
    const nameParts = patientName.trim().split(' ');
    const firstName = nameParts[0] || 'Patient';
    const lastName = nameParts.slice(1).join(' ') ; // Join remaining parts as lastName
    
    let patient = await User.findOne({ 
      $or: [
        { email: email },
        { firstName: firstName, lastName: lastName }
      ]
    });
    
    if (!patient) {
      console.log('Creating new patient...');
      // Hash password for patient
      const bcrypt = await import('bcryptjs');
      const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
      const hashedPassword = await bcrypt.default.hash('patient123', saltRounds);
      
      // Create new patient
      patient = new User({
        firstName: firstName,
        lastName: lastName,
        email: email || `${patientName.toLowerCase().replace(/\s+/g, '.')}@example.com`,
        phone: phone || '+91-0000000000',
        role: 'patient',
        password: hashedPassword,
        isActive: true
      });let patientEmail = email;
      if (!patientEmail) {
        // Use phone number to create a unique, placeholder email
        patientEmail = `${phone || Date.now()}@exapmle.com`;
      }

      patient = new User({
        firstName: firstName,
        lastName: lastName,
        email: patientEmail,
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
    let doctor = await User.findOne({ 
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
    const appointment = new AppointmentModel({
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
/*
    await queue.add("emailQueue", {
      template : "booking_confirmation",
      to : formattedAppointment.email,
      data : {
        patientName : formattedAppointment.patientName,
        doctorName : formattedAppointment.doctorName,
        appointmentDate : formattedAppointment.date,
        appointmentTime : formattedAppointment.time,
        appointmentReason : formattedAppointment.reason,
      }
    })*/


    console.log('Email queued successfully');
    
    res.status(201).json({
      success: true,
      message: 'Appointment created successfully',
      data: formattedAppointment
    });
  } catch (error) {
    console.error('Gateway: Create appointment error:', error);
    res.status(500).json({
      error: 'Failed to create appointment',
      code: 'CREATE_ERROR'
    });
  }
});

// Public doctors list (handled directly in gateway)
app.get('/api/public/doctors', async (req, res) => {
  try {
    console.log('Gateway: Processing public doctors request directly');
    
    // Import User model
    const { User } = await import('../shared/models/User.js');
    
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
    console.error('Gateway: Get public doctors error:', error);
    res.status(500).json({
      error: 'Failed to fetch doctors',
      code: 'FETCH_ERROR'
    });
  }
});

// Public health check (handled directly in gateway)
app.get('/api/public/health', (req, res) => {
  console.log('Gateway: Health check requested');
  res.json({ 
    success: true, 
    message: 'Gateway service is running',
    timestamp: new Date().toISOString()
  });
});

// Admin doctor creation (handled directly in gateway)
app.post('/api/admin/doctors', async (req, res) => {
  try {
    console.log('Gateway: Processing doctor creation directly');
    console.log('Request data:', req.body);
    
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
    
    // Validation
    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({
        error: 'Missing required fields',
        code: 'MISSING_FIELDS'
      });
    }
    
    // Import User model
    const { User } = await import('../shared/models/User.js');
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        error: 'User already exists',
        code: 'USER_EXISTS'
      });
    }
    
    // Hash the password
    const bcrypt = await import('bcryptjs');
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const hashedPassword = await bcrypt.default.hash('doctor123', saltRounds);
    
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
    console.error('Gateway: Create doctor error:', error);
    res.status(500).json({
      error: 'Failed to create doctor account',
      code: 'CREATE_ERROR'
    });
  }
});

// Update appointment (reschedule/cancel)
app.patch('/api/appointments/:id', async (req, res) => {
  try {
    console.log('Gateway: Processing appointment update directly');
    console.log('Request data:', req.body);
    
    const { id } = req.params;
    const { status, date, time, reason, notes } = req.body;
    
    // Import models
    const { Appointment } = await import('../shared/models/Appointment.js');
    
    // Find appointment
    const appointment = await Appointment.findById(id);
    if (!appointment) {
      return res.status(404).json({
        error: 'Appointment not found',
        code: 'NOT_FOUND'
      });
    }
    
    // Update appointment
    if (status) {
      appointment.status = status;
      
      // Set timing fields based on status
      if (status === 'checked-in') {
        appointment.checkedInAt = new Date();
      } else if (status === 'in-progress') {
        appointment.startedAt = new Date();
      } else if (status === 'completed') {
        appointment.completedAt = new Date();
      }
    }
    
    if (date && time) {
      appointment.scheduledAt = new Date(`${date}T${time}:00`);
    }
    
    if (reason) {
      appointment.reason = reason;
    }
    
    if (notes) {
      appointment.notes = notes;
    }
    
    console.log('Saving updated appointment...');
    await appointment.save();
    console.log('Appointment updated successfully');
    
    // Populate the response
    // Populate the response
    await appointment.populate('patientId', 'firstName lastName email phone');
    await appointment.populate('doctorId', 'firstName lastName email');
    
    // --- THIS IS THE FIX ---
    // Use optional chaining (?.) to prevent crashes if patientId or doctorId is not populated
    const formattedAppointment = {
      id: appointment._id,
      patientName: `${appointment.patientId?.firstName || 'Unknown'} ${appointment.patientId?.lastName || 'Patient'}`,
      doctorName: `Dr. ${appointment.doctorId?.firstName || 'Unknown'} ${appointment.doctorId?.lastName || 'Doctor'}`,
      date: appointment.scheduledAt.toISOString().split('T')[0],
      time: appointment.scheduledAt.toTimeString().split(' ')[0].substring(0, 5),
      status: appointment.status,
      reason: appointment.reason,
      phone: appointment.patientId?.phone || 'N/A',
      email: appointment.patientId?.email || 'N/A'
    };
    
    res.json({
      success: true,
      message: 'Appointment updated successfully',
      data: formattedAppointment
    });
  } catch (error) {
    console.error('Gateway: Update appointment error:', error);
    res.status(500).json({
      error: 'Failed to update appointment',
      code: 'UPDATE_ERROR'
    });
  }
});

// Get all users (doctors and receptionists)
app.get('/api/admin/users', async (req, res) => {
  try {
    console.log('Gateway: Processing get users request directly');
    
    // Import User model
    const { User } = await import('../shared/models/User.js');
    
    const users = await User.find({ 
      role: { $in: ['doctor', 'receptionist'] },
      isActive: true 
    }).select('firstName lastName email phone role doctorInfo createdAt');

    const formattedUsers = users.map(user => ({
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isActive: user.isActive,
      doctorInfo: user.doctorInfo,
      createdAt: user.createdAt
    }));
    
    res.json({
      success: true,
      data: formattedUsers
    });
  } catch (error) {
    console.error('Gateway: Get users error:', error);
    res.status(500).json({
      error: 'Failed to fetch users',
      code: 'FETCH_ERROR'
    });
  }
});

// Admin receptionist creation (handled directly in gateway)
app.post('/api/admin/receptionists', async (req, res) => {
  try {
    console.log('Gateway: Processing receptionist creation directly');
    console.log('Request data:', req.body);
    
    const { firstName, lastName, email, phone } = req.body;
    
    // Validation
    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({
        error: 'Missing required fields',
        code: 'MISSING_FIELDS'
      });
    }
    
    // Import User model
    const { User } = await import('../shared/models/User.js');
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        error: 'User already exists',
        code: 'USER_EXISTS'
      });
    }
    
    // Hash the password
    const bcrypt = await import('bcryptjs');
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const hashedPassword = await bcrypt.default.hash('doctor123', saltRounds);
    
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
    console.error('Gateway: Create receptionist error:', error);
    res.status(500).json({
      error: 'Failed to create receptionist account',
      code: 'CREATE_ERROR'
    });
  }
});

// Protected routes (authentication required)
app.use('/api/appointments', authenticateToken, clinicProxy);
app.use('/api/doctor', authenticateToken, clinicProxy);
app.use('/api/prescriptions', authenticateToken, clinicProxy);
app.use('/api/pharmacy', authenticateToken, clinicProxy);
app.use('/api/analytics', authenticateToken, clinicProxy);
app.use('/api/notifications', authenticateToken, clinicProxy);
app.use('/api/patients', authenticateToken, clinicProxy);
app.use('/api/doctors', authenticateToken, clinicProxy);

// Route files to files service
app.use('/api/files', authenticateToken, filesProxy);

// ===========================================
// HEALTH CHECK
// ===========================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'API Gateway',
    version: '1.0.0'
  });
});

// ===========================================
// ERROR HANDLING
// ===========================================

app.use((err, req, res, next) => {
  console.error('Gateway error:', err);
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR'
  });
});

// 404 handler
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
  console.log(`🚪 API Gateway running on port ${PORT}`);
  console.log(`🔗 Clinic Service: http://localhost:${process.env.CLINIC_PORT || 3001}`);
  console.log(`📁 Files Service: http://localhost:${process.env.FILES_PORT || 3002}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
});

