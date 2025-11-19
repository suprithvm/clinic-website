import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Invalid email format']
  },
  password: {
    type: String,
    required: true,
    minlength: 6,
    select: false // Never return password in queries
  },
  firstName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  lastName: {
    type: String,
    required: false,
    default: '',
    trim: true,
    maxlength: 50
  },
  phone: {
    type: String,
    required: true,
    match: [/^\+?[\d\s\-\(\)]+$/, 'Invalid phone format']
  },
  role: {
    type: String,
    required: true,
    enum: ['admin', 'receptionist', 'doctor', 'pharmacy', 'patient'],
    index: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date
  },
  
  // Role-specific fields
  doctorInfo: {
    qualification: String,
    specialization: [String],
    licenseNumber: { type: String, unique: true, sparse: true },
    experience: { type: Number, default: 0 },
    consultationFee: { type: Number, default: 0 },
    availableSlots: [{
      dayOfWeek: { type: Number, min: 0, max: 6 },
      startTime: String,
      endTime: String,
      isActive: { type: Boolean, default: true }
    }]
  },
  
  pharmacistInfo: {
    licenseNumber: { type: String, unique: true, sparse: true },
    specialization: [String]
  },
  
  // Patient-specific fields
  patientInfo: {
    dateOfBirth: Date,
    gender: { type: String, enum: ['male', 'female', 'other'] },
    address: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: { type: String, default: 'India' }
    },
    emergencyContact: {
      name: String,
      relationship: String,
      phone: String
    },
    medicalHistory: [{
      condition: String,
      diagnosisDate: Date,
      status: { type: String, enum: ['active', 'resolved', 'chronic'], default: 'active' },
      notes: String,
      doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    }],
    allergies: [{
      allergen: String,
      severity: { type: String, enum: ['mild', 'moderate', 'severe'] },
      reaction: String,
      notes: String
    }],
    insurance: {
      provider: String,
      policyNumber: String,
      expiryDate: Date,
      coverage: { type: Number, min: 0, max: 100 }
    }
  },
  
  // System fields
  preferences: {
    language: { type: String, default: 'en' },
    timezone: { type: String, default: 'Asia/Kolkata' },
    notifications: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: true },
      push: { type: Boolean, default: true }
    }
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Index for performance
userSchema.index({ email: 1 });
userSchema.index({ role: 1 });
userSchema.index({ isActive: 1 });
userSchema.index({ createdAt: -1 });

// Pre-save middleware
userSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Static methods
userSchema.statics.findByEmail = function(email) {
  return this.findOne({ email: email.toLowerCase() });
};

userSchema.statics.findByRole = function(role) {
  return this.find({ role, isActive: true });
};

// Instance methods
userSchema.methods.updateLastLogin = function() {
  this.lastLogin = new Date();
  return this.save();
};

userSchema.methods.getRoleInfo = function() {
  switch (this.role) {
    case 'doctor':
      return this.doctorInfo;
    case 'pharmacy':
      return this.pharmacistInfo;
    case 'patient':
      return this.patientInfo;
    default:
      return null;
  }
};

export const User = mongoose.model('User', userSchema);
export default User;

