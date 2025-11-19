import mongoose from 'mongoose';

const appointmentSchema = new mongoose.Schema({
  appointmentId: {
    type: String,
    unique: true,
    required: true,
    index: true
  },
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  doctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  scheduledAt: {
    type: Date,
    required: true,
    index: true
  },
  duration: {
    type: Number,
    default: 30, // minutes
    min: 15,
    max: 480
  },
  status: {
    type: String,
    // --- THIS IS THE CHANGE ---
    enum: ['scheduled', 'confirmed', 'attended', 'not-attended', 'cancelled'],
    default: 'confirmed', // <-- Automatically confirmed
    index: true
  },
  type: {
    type: String,
    enum: ['consultation', 'follow-up', 'emergency', 'telemedicine'],
    default: 'consultation'
  },
  reason: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  notes: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  
  // Timing
  checkedInAt: {
    type: Date
  },
  startedAt: {
    type: Date
  },
  completedAt: {
    type: Date
  },
  
  // Billing
  consultationFee: {
    type: Number,
    default: 0,
    min: 0
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'partial', 'waived'],
    default: 'pending'
  },
  
  // System fields
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
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

// Virtual for patient info
appointmentSchema.virtual('patient', {
  ref: 'User',
  localField: 'patientId',
  foreignField: '_id',
  justOne: true
});

// Virtual for doctor info
appointmentSchema.virtual('doctor', {
  ref: 'User',
  localField: 'doctorId',
  foreignField: '_id',
  justOne: true
});

// Indexes for performance
appointmentSchema.index({ patientId: 1, scheduledAt: 1 });
appointmentSchema.index({ doctorId: 1, scheduledAt: 1 });
appointmentSchema.index({ status: 1, scheduledAt: 1 });
appointmentSchema.index({ createdBy: 1 });

// Pre-save middleware
appointmentSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Static methods
appointmentSchema.statics.findByPatient = function(patientId) {
  return this.find({ patientId }).sort({ scheduledAt: -1 });
};

appointmentSchema.statics.findByDoctor = function(doctorId) {
  return this.find({ doctorId }).sort({ scheduledAt: -1 });
};

appointmentSchema.statics.findByDateRange = function(startDate, endDate) {
  return this.find({
    scheduledAt: {
      $gte: startDate,
      $lte: endDate
    }
  }).sort({ scheduledAt: 1 });
};

appointmentSchema.statics.findByStatus = function(status) {
  return this.find({ status }).sort({ scheduledAt: 1 });
};

// Instance methods
appointmentSchema.methods.updateStatus = function(newStatus) {
  this.status = newStatus;
  this.updatedAt = new Date();
  
  // Set timing fields based on status
  switch (newStatus) {
    case 'attended': // <-- CHANGED
      this.checkedInAt = new Date();
      break;
    case 'in-progress':
      this.startedAt = new Date();
      break;
    case 'completed':
      this.completedAt = new Date();
      break;
  }
  
  return this.save();
};

appointmentSchema.methods.calculateDuration = function() {
  if (this.startedAt && this.completedAt) {
    return Math.round((this.completedAt - this.startedAt) / (1000 * 60)); // minutes
  }
  return this.duration;
};

export const Appointment = mongoose.model('Appointment', appointmentSchema);
export default Appointment;