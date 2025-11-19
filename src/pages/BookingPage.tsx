import { useState, useEffect } from 'react'
import { Calendar, Clock, User, Phone, Mail, Stethoscope, CheckCircle, ArrowRight, Loader2 } from 'lucide-react'
import { publicDoctorsApi, publicBookingApi, type Doctor } from '../services/api'

export function BookingPage() {
  const [form, setForm] = useState({ 
    name: '', 
    phone: '', 
    email: '', 
    date: '', 
    time: '', 
    doctorId: '', 
    reason: '',
    age: '',
    gender: ''
  })
  const [step, setStep] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [isLoadingDoctors, setIsLoadingDoctors] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load doctors on component mount
  useEffect(() => {
    loadDoctors()
  }, [])

  const loadDoctors = async () => {
    try {
      setIsLoadingDoctors(true)
      setError(null)
      const response = await publicDoctorsApi.getDoctors()
      
      if (response.success) {
        setDoctors(response.data)
      } else {
        setError('Failed to load doctors')
      }
    } catch (err) {
      setError('Failed to load doctors')
      console.error('Error loading doctors:', err)
    } finally {
      setIsLoadingDoctors(false)
    }
  }

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const timeSlots = [
    '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
    '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'
  ]

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    
    // Frontend validation
    if (!form.name.trim()) {
      setError('Please enter your full name')
      setIsSubmitting(false)
      return
    }
    
    if (!form.phone.trim()) {
      setError('Please enter your phone number')
      setIsSubmitting(false)
      return
    }
    
    
    
    if (!form.date) {
      setError('Please select a date')
      setIsSubmitting(false)
      return
    }
    
    if (!form.time) {
      setError('Please select a time')
      setIsSubmitting(false)
      return
    }
    
    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(form.email)) {
      setError('Please enter a valid email address')
      setIsSubmitting(false)
      return
    }
    
    // Phone validation (basic)
    if (form.phone.length !== 10) {
      setError('Please enter a valid phone number')
      setIsSubmitting(false)
      return
    }
    
    try {
      const selectedDoctor = doctors.find(d => d.id === form.doctorId)
      const appointmentData = {
        patientName: form.name.trim(),
        doctorName: selectedDoctor?.name || 'General Doctor',
        date: form.date,
        time: form.time,
        reason: form.reason,
        phone: form.phone.trim(),
        email: form.email.trim()
      }

      console.log('Submitting appointment data:', appointmentData)
      console.log('Selected doctor:', selectedDoctor)

      const response = await publicBookingApi.createAppointment(appointmentData)
      console.log('Appointment API response:', response)
      
      if (response.success) {
        setStep(3) // Success step
      } else {
        setError('Failed to book appointment. Please try again.')
      }
    } catch (err) {
      setError('Failed to book appointment. Please try again.')
      console.error('Error booking appointment:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (step === 3) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center animate-in fade-in-50 slide-in-from-bottom-4 duration-500">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6 animate-in zoom-in-50 duration-700">
            <CheckCircle className="w-10 h-10 text-green-600 animate-in scale-in-50 duration-500" />
          </div>
          <h2 className="text-3xl font-bold text-gray-900 mb-4 animate-in fade-in-50 slide-in-from-bottom-2 duration-700">
            🎉 Appointment Booked!
          </h2>
          <p className="text-gray-600 mb-6 animate-in fade-in-50 slide-in-from-bottom-2 duration-700 delay-200">
            Your appointment has been successfully scheduled. You'll receive a confirmation email shortly.
          </p>
          <div className="bg-gradient-to-r from-blue-50 to-green-50 rounded-lg p-6 mb-6 animate-in fade-in-50 slide-in-from-bottom-2 duration-700 delay-300">
            <div className="text-sm text-gray-800">
              <div className="font-semibold text-lg mb-3">Appointment Details:</div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="font-medium">Date:</span>
                  <span>{new Date(form.date).toLocaleDateString('en-US', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Time:</span>
                  <span>{form.time}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Doctor:</span>
                  <span>{doctors.find(d => d.id === form.doctorId)?.name || 'General Doctor'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Patient:</span>
                  <span>{form.name}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <button 
              onClick={() => { 
                setStep(1); 
                setForm({ name: '', phone: '', email: '', date: '', time: '', doctorId: '', reason: '', age: '', gender: '' });
                setError(null);
              }}
              className="btn-primary w-full animate-in fade-in-50 slide-in-from-bottom-2 duration-700 delay-400"
            >
              Book Another Appointment
            </button>
            <button 
              onClick={() => window.location.href = '/'}
              className="btn-secondary w-full animate-in fade-in-50 slide-in-from-bottom-2 duration-700 delay-500"
            >
              Return to Home
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-responsive-lg font-bold text-gray-900 mb-4">
            Book Your Appointment
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Schedule your visit with our experienced healthcare professionals. 
            Quick, easy, and secure booking process.
          </p>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-center mb-12">
          <div className="flex items-center space-x-4">
            {[1, 2].map((stepNumber) => (
              <div key={stepNumber} className="flex items-center">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium ${
                  step >= stepNumber 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-gray-200 text-gray-600'
                }`}>
                  {stepNumber}
                </div>
                {stepNumber < 2 && (
                  <div className={`w-16 h-1 mx-2 ${
                    step > stepNumber ? 'bg-blue-600' : 'bg-gray-200'
                  }`} />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Form */}
          <div className="lg:col-span-2">
            <form onSubmit={handleSubmit} className="space-y-6">
              {step === 1 && (
                <div className="card p-8">
                  <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center">
                    <User className="w-6 h-6 mr-3 text-blue-600" />
                    Personal Information
                  </h2>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <label className="form-label">Full Name *</label>
                      <input 
                        className={`form-input ${!form.name.trim() && form.name ? 'border-red-300' : ''}`}
                        placeholder="Enter your full name (e.g., John Doe)" 
                        value={form.name} 
                        onChange={(e)=>update('name', e.target.value)}
                        required
                      />
                      {!form.name.trim() && form.name && (
                        <p className="text-red-500 text-sm mt-1">Please enter your full name</p>
                      )}
                    </div>
                    <div>
                      <label className="form-label">Phone Number *</label>
                      <input 
                        className={`form-input ${form.phone && form.phone.length < 10 ? 'border-red-300' : ''}`}
                        placeholder="+1 (555) 123-4567" 
                        value={form.phone} 
                        onChange={(e)=>update('phone', e.target.value)}
                        required
                      />
                      {form.phone && form.phone.length < 10 && (
                        <p className="text-red-500 text-sm mt-1">Please enter a valid phone number</p>
                      )}
                    </div>
                    <div>
                      <label className="form-label">Email Address *</label>
                      <input 
                        type="email"
                        className={`form-input ${form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) ? 'border-red-300' : ''}`}
                        placeholder="your.email@example.com" 
                        value={form.email} 
                        onChange={(e)=>update('email', e.target.value)}
                        
                      />
                      {form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) && (
                        <p className="text-red-500 text-sm mt-1">Please enter a valid email address</p>
                      )}
                    </div>
                    <div>
                      <label className="form-label">Age</label>
                      <input 
                        type="number"
                        className="form-input" 
                        placeholder="25" 
                        value={form.age} 
                        onChange={(e)=>update('age', e.target.value)}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="form-label">Gender</label>
                      <select 
                        className="form-input" 
                        value={form.gender} 
                        onChange={(e)=>update('gender', e.target.value)}
                      >
                        <option value="">Select Gender</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="other">Other</option>
                        <option value="prefer-not-to-say">Prefer not to say</option>
                      </select>
                    </div>
                  </div>
                  
                  <div className="flex justify-end mt-8">
                    <button 
                      type="button"
                      onClick={() => setStep(2)}
                      className="btn-primary inline-flex items-center"
                      disabled={!form.name || !form.phone || !form.email}
                    >
                      Next Step
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </button>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="card p-8">
                  <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center">
                    <Calendar className="w-6 h-6 mr-3 text-blue-600" />
                    Appointment Details
                  </h2>
                  
                  <div className="space-y-6">
                    <div className="grid md:grid-cols-2 gap-6">
                      <div>
                        <label className="form-label">Preferred Date *</label>
                        <input 
                          type="date" 
                          className="form-input" 
                          value={form.date} 
                          onChange={(e)=>update('date', e.target.value)}
                          min={new Date().toISOString().split('T')[0]}
                          required
                        />
                      </div>
                      <div>
                        <label className="form-label">Preferred Time *</label>
                        <select 
                          className="form-input" 
                          value={form.time} 
                          onChange={(e)=>update('time', e.target.value)}
                          required
                        >
                          <option value="">Select Time</option>
                          {timeSlots.map(time => (
                            <option key={time} value={time}>{time}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="form-label">Select Doctor (Optional)</label>
                      {isLoadingDoctors ? (
                        <div className="flex items-center justify-center p-8">
                          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                          <span className="ml-2 text-gray-600">Loading doctors...</span>
                        </div>
                      ) : error ? (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                          <div className="text-red-800 text-sm">
                            {error}
                            <button 
                              onClick={loadDoctors}
                              className="ml-2 text-red-600 hover:text-red-500 underline"
                            >
                              Try again
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="grid gap-3">
                          {doctors.length === 0 ? (
                            <div className="text-center py-4 text-gray-500">
                              No doctors available at the moment
                            </div>
                          ) : (
                            doctors.map(doctor => (
                              <label key={doctor.id} className="flex items-center p-4 border rounded-lg cursor-pointer hover:bg-blue-50 transition-colors">
                                <input 
                                  type="radio" 
                                  name="doctor" 
                                  value={doctor.id}
                                  checked={form.doctorId === doctor.id}
                                  onChange={(e)=>update('doctorId', e.target.value)}
                                  className="mr-3"
                                />
                                <div className="flex-1">
                                  <div className="font-semibold text-gray-900">{doctor.name}</div>
                                  <div className="text-sm text-gray-600">{doctor.specialty} • {doctor.experience} years experience</div>
                                  <div className="flex items-center mt-1">
                                    <div className="flex text-yellow-400">
                                      {[...Array(5)].map((_, i) => (
                                        <span key={i} className={i < Math.floor(doctor.rating) ? 'text-yellow-400' : 'text-gray-300'}>★</span>
                                      ))}
                                    </div>
                                    <span className="text-sm text-gray-600 ml-2">{doctor.rating}</span>
                                    <span className="text-sm text-gray-500 ml-2">• ₹{doctor.consultationFee} consultation fee</span>
                                  </div>
                                </div>
                              </label>
                            ))
                          )}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="form-label">Reason for Visit</label>
                      <textarea 
                        className="form-input" 
                        rows={4} 
                        placeholder="Please describe your symptoms or reason for the appointment..."
                        value={form.reason} 
                        onChange={(e)=>update('reason', e.target.value)}
                      />
                    </div>
                  </div>
                  
                  {error && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                      <div className="text-red-800 text-sm">{error}</div>
                    </div>
                  )}
                  
                  <div className="flex justify-between mt-8">
                    <button 
                      type="button"
                      onClick={() => setStep(1)}
                      className="btn-secondary"
                    >
                      Back
                    </button>
                    <button 
                      type="submit"
                      className="btn-primary inline-flex items-center"
                      disabled={!form.date || !form.time || isSubmitting}
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          Booking...
                        </>
                      ) : (
                        <>
                          <Stethoscope className="w-4 h-4 mr-2" />
                          Book Appointment
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </form>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <div className="card p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Why Choose Us?</h3>
              <ul className="space-y-3">
                <li className="flex items-start">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-3 mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-gray-600">Same-day appointments available</span>
                </li>
                <li className="flex items-start">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-3 mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-gray-600">Digital prescriptions sent instantly</span>
                </li>
                <li className="flex items-start">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-3 mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-gray-600">HIPAA compliant and secure</span>
                </li>
                <li className="flex items-start">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-3 mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-gray-600">24/7 emergency care</span>
                </li>
              </ul>
            </div>

            <div className="card p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Contact Information</h3>
              <div className="space-y-3 text-sm">
                <div className="flex items-center">
                  <Phone className="w-4 h-4 text-blue-600 mr-3" />
                  <span className="text-gray-600">+1 (555) 123-4567</span>
                </div>
                <div className="flex items-center">
                  <Mail className="w-4 h-4 text-blue-600 mr-3" />
                  <span className="text-gray-600">info@medicareclinic.com</span>
                </div>
                <div className="flex items-center">
                  <Clock className="w-4 h-4 text-blue-600 mr-3" />
                  <span className="text-gray-600">Mon-Fri: 8AM-8PM</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}


