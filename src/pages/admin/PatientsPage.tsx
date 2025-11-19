import { useState, useEffect } from 'react'
import {
  Search,
  Plus,
  Filter,
  MoreVertical,
  User,
  Phone,
  Mail,
  Calendar,
  Edit,
  Trash2,
  Eye,
  Loader2,
  AlertCircle,
  CalendarPlus,
  Clock,
  FileText,
  CheckCircle,
  XCircle
} from 'lucide-react'
import { useApi } from '../../hooks/useApi'
import { 
  appointmentsApi, 
  doctorsApi, 
  publicBookingApi, 
  type Doctor, 
  type Appointment 
} from '../../services/api'
import { useToast, ToastContainer } from '../../components/ui/Toast'

type Patient = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  patientInfo?: {
    dateOfBirth?: string;
    gender?: string;
    address?: {
      city: string;
      state: string;
    };
    medicalHistory?: Array<{
      condition: string;
      status: string;
    }>;
  };
}

export function PatientsPage() {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [showAddPatientModal, setShowAddPatientModal] = useState(false)
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [showPatientDetails, setShowPatientDetails] = useState(false)
  
  // Delete states
  const [showDeletePatientModal, setShowDeletePatientModal] = useState(false)
  const [selectedPatientToDelete, setSelectedPatientToDelete] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null)

  // Booking & History states
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [showBookModal, setShowBookModal] = useState(false)
  const [bookingData, setBookingData] = useState({
    doctorId: '',
    date: '',
    time: '',
    reason: ''
  })
  const [isBooking, setIsBooking] = useState(false)
  const [patientHistory, setPatientHistory] = useState<Appointment[]>([])
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)

  const { success, error: toastError, toasts, removeToast } = useToast()

  // Fetch patients from API
  const { data: patientsData, isLoading, error, refetch } = useApi(async () => {
    const response = await fetch('http://localhost:3000/api/patients', {
      credentials: 'include'
    })
    if (!response.ok) {
      throw new Error('Failed to fetch patients')
    }
    return response.json()
  })

  // Load doctors on mount
  useEffect(() => {
    loadDoctors()
  }, [])

  const loadDoctors = async () => {
    try {
      const response = await doctorsApi.getDoctors()
      if (response.success) {
        setDoctors(response.data)
      }
    } catch (err) {
      console.error('Failed to load doctors', err)
    }
  }

  // Handle View Patient (Fetch History)
  const handleViewPatient = async (patient: Patient) => {
    setSelectedPatient(patient)
    setShowPatientDetails(true)
    setIsLoadingHistory(true)
    setPatientHistory([])
    
    try {
      // Fetch all appointments and filter for this patient
      // Note: Ideally the API should support /appointments/patient/:id or similar
      const response = await appointmentsApi.getAppointments()
      if (response.success && response.data) {
        const history = response.data.filter(apt => 
          apt.email === patient.email || apt.phone === patient.phone
        ).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) // Sort by date desc
        setPatientHistory(history)
      }
    } catch (err) {
      console.error('Failed to load patient history', err)
      toastError('Error', 'Could not load appointment history')
    } finally {
      setIsLoadingHistory(false)
    }
  }

  // Handle Book Click
  const handleBookClick = (patient: Patient) => {
    setSelectedPatient(patient)
    setBookingData({
      doctorId: '',
      date: '',
      time: '',
      reason: ''
    })
    setShowBookModal(true)
  }

  // Submit Booking
  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedPatient) return

    setIsBooking(true)
    try {
      const selectedDoctor = doctors.find(d => d.id === bookingData.doctorId)
      
      const appointmentPayload = {
        patientName: `${selectedPatient.firstName} ${selectedPatient.lastName}`,
        email: selectedPatient.email,
        phone: selectedPatient.phone,
        doctorName: selectedDoctor?.name || 'General Doctor',
        date: bookingData.date,
        time: bookingData.time,
        reason: bookingData.reason
      }

      const response = await publicBookingApi.createAppointment(appointmentPayload)
      
      if (response.success) {
        success('Appointment Booked', `Appointment scheduled for ${selectedPatient.firstName}`)
        setShowBookModal(false)
      } else {
        toastError('Booking Failed', response.message || 'Please try again')
      }
    } catch (err) {
      console.error(err)
      toastError('Booking Failed', 'An error occurred while booking')
    } finally {
      setIsBooking(false)
    }
  }
  
  // Handle patient deletion
  const handleDeletePatient = async () => {
    if (!selectedPatientToDelete) return

    setIsDeleting(true)
    setDeleteError(null)
    setDeleteSuccess(null)

    try {
      const response = await fetch(`http://localhost:3000/api/patients/${selectedPatientToDelete}`, {
        method: 'DELETE',
        credentials: 'include'
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Failed to delete patient')
      }

      setDeleteSuccess('Patient deleted successfully!')
      refetch()
      setShowDeletePatientModal(false)
      setSelectedPatientToDelete(null)

    } catch (error: any) {
      setDeleteError(error.message || 'An unknown error occurred')
    } finally {
      setIsDeleting(false)
    }
  }

  const patients: Patient[] = patientsData?.data || []

  const filteredPatients = patients.filter(patient => {
    const matchesSearch =
      patient.firstName.toLowerCase().includes(query.toLowerCase()) ||
      patient.lastName.toLowerCase().includes(query.toLowerCase()) ||
      patient.email.toLowerCase().includes(query.toLowerCase()) ||
      patient.phone.includes(query)

    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && patient.isActive) ||
      (statusFilter === 'inactive' && !patient.isActive)

    return matchesSearch && matchesStatus
  })

  const stats = {
    total: patients.length,
    active: patients.filter(p => p.isActive).length,
    inactive: patients.filter(p => !p.isActive).length,
    newThisMonth: patients.filter(p => {
      const createdDate = new Date(p.createdAt)
      const thisMonth = new Date()
      thisMonth.setDate(1)
      return createdDate >= thisMonth
    }).length
  }

  const calculateAge = (dateOfBirth?: string) => {
    if (!dateOfBirth) return 'N/A'
    const birthDate = new Date(dateOfBirth)
    const today = new Date()
    let age = today.getFullYear() - birthDate.getFullYear()
    const monthDiff = today.getMonth() - birthDate.getMonth()
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--
    }
    return age
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled': return 'bg-blue-100 text-blue-800'
      case 'confirmed': return 'bg-yellow-100 text-yellow-800'
      case 'attended': return 'bg-green-100 text-green-800'
      case 'completed': return 'bg-gray-100 text-gray-800'
      case 'cancelled': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center space-x-2">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span>Loading patients...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4">
        <div className="flex">
          <AlertCircle className="h-5 w-5 text-red-400" />
          <div className="ml-3">
            <h3 className="text-sm font-medium text-red-800">Error</h3>
            <div className="mt-2 text-sm text-red-700">{error.message}</div> 
            <button
              onClick={() => refetch()}
              className="mt-2 text-sm text-red-600 hover:text-red-500 underline"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Patient Management</h1>
          <p className="text-gray-600">Manage patient records and information</p>
        </div>
        <div className="flex gap-3">
          <button className="btn-secondary inline-flex items-center">
            <Filter className="w-4 h-4 mr-2" />
            Filter
          </button>
          <button
            onClick={() => setShowAddPatientModal(true)}
            className="btn-primary inline-flex items-center"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Patient
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* ... existing stats cards ... */}
        <div className="card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Patients</p>
              <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
            </div>
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <User className="w-6 h-6 text-blue-600" />
            </div>
          </div>
        </div>
        <div className="card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Active</p>
              <p className="text-2xl font-bold text-green-600">{stats.active}</p>
            </div>
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
          </div>
        </div>
        <div className="card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Inactive</p>
              <p className="text-2xl font-bold text-red-600">{stats.inactive}</p>
            </div>
            <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
              <XCircle className="w-6 h-6 text-red-600" />
            </div>
          </div>
        </div>
        <div className="card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">New This Month</p>
              <p className="text-2xl font-bold text-purple-600">{stats.newThisMonth}</p>
            </div>
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
              <Calendar className="w-6 h-6 text-purple-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Search and Filter */}
      <div className="card p-6">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4 mb-6">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                placeholder="Search patients..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="form-input pl-10"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="form-input w-auto"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        {/* Patients List */}
        <div className="space-y-4">
          {filteredPatients.length === 0 ? (
            <div className="text-center py-8">
              <User className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No patients found</h3>
              <p className="text-gray-600 mb-4">
                {query || statusFilter !== 'all'
                  ? 'Try adjusting your search or filter criteria'
                  : 'Get started by adding your first patient'
                }
              </p>
              {!query && statusFilter === 'all' && (
                <button
                  onClick={() => setShowAddPatientModal(true)}
                  className="btn-primary"
                >
                  Add First Patient
                </button>
              )}
            </div>
          ) : (
            filteredPatients.map((patient) => (
              <div key={patient.id} className="border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">
                        {patient.firstName} {patient.lastName}
                      </h3>
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${patient.isActive
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                        }`}>
                        {patient.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600">
                      <div className="flex items-center gap-2">
                        <Mail className="w-4 h-4" />
                        <span>{patient.email}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Phone className="w-4 h-4" />
                        <span>{patient.phone}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4" />
                        <span>Age: {calculateAge(patient.patientInfo?.dateOfBirth)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        <span>Joined: {formatDate(patient.createdAt)}</span>
                      </div>
                    </div>
                    {patient.patientInfo?.medicalHistory && patient.patientInfo.medicalHistory.length > 0 && (
                      <div className="mt-2">
                        <p className="text-sm text-gray-600">
                          <strong>Medical History:</strong> {patient.patientInfo.medicalHistory.map(h => h.condition).join(', ')}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleBookClick(patient)}
                      className="btn-primary text-sm inline-flex items-center"
                      title="Book Appointment"
                    >
                      <CalendarPlus className="w-4 h-4 mr-1" />
                      Book
                    </button>
                    <button
                      onClick={() => handleViewPatient(patient)}
                      className="btn-secondary text-sm"
                    >
                      <Eye className="w-4 h-4 mr-1" />
                      View
                    </button>
                    <button className="btn-secondary text-sm">
                      <Edit className="w-4 h-4 mr-1" />
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        setSelectedPatientToDelete(patient.id)
                        setShowDeletePatientModal(true)
                      }}
                      className="btn-secondary text-sm text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Patient Details & History Modal */}
      {showPatientDetails && selectedPatient && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">
                  Patient Details & History
                </h2>
                <button
                  onClick={() => setShowPatientDetails(false)}
                  className="text-gray-400 hover:text-gray-600 text-3xl leading-none"
                >
                  &times;
                </button>
              </div>

              <div className="grid lg:grid-cols-2 gap-8">
                {/* Left Col: Personal Details */}
                <div className="space-y-6">
                  <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
                    <h3 className="font-semibold text-gray-900 mb-4 border-b pb-2">Personal Information</h3>
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-xs font-medium text-gray-500 uppercase">Name</label>
                          <p className="text-sm font-medium text-gray-900">{selectedPatient.firstName} {selectedPatient.lastName}</p>
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-500 uppercase">Status</label>
                          <p className="text-sm font-medium text-gray-900">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${selectedPatient.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                              {selectedPatient.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </p>
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-500 uppercase">Email</label>
                          <p className="text-sm text-gray-900">{selectedPatient.email}</p>
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-500 uppercase">Phone</label>
                          <p className="text-sm text-gray-900">{selectedPatient.phone}</p>
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-500 uppercase">Age</label>
                          <p className="text-sm text-gray-900">{calculateAge(selectedPatient.patientInfo?.dateOfBirth)}</p>
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-500 uppercase">Gender</label>
                          <p className="text-sm text-gray-900">{selectedPatient.patientInfo?.gender || 'Not specified'}</p>
                        </div>
                      </div>

                      {selectedPatient.patientInfo?.address && (
                        <div className="pt-2">
                          <label className="text-xs font-medium text-gray-500 uppercase">Address</label>
                          <p className="text-sm text-gray-900">
                            {selectedPatient.patientInfo.address.city}, {selectedPatient.patientInfo.address.state}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {selectedPatient.patientInfo?.medicalHistory && selectedPatient.patientInfo.medicalHistory.length > 0 && (
                    <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-100">
                      <h3 className="font-semibold text-yellow-900 mb-3">Medical History</h3>
                      <div className="space-y-2">
                        {selectedPatient.patientInfo.medicalHistory.map((history, index) => (
                          <div key={index} className="flex items-center justify-between text-sm bg-white p-2 rounded border border-yellow-100">
                            <span className="font-medium text-gray-900">{history.condition}</span>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${history.status === 'active' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                              {history.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Right Col: Appointment History */}
                <div className="space-y-4">
                  <h3 className="font-semibold text-gray-900 flex items-center">
                    <Calendar className="w-4 h-4 mr-2 text-blue-500" />
                    Appointment History
                  </h3>
                  
                  {isLoadingHistory ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                    </div>
                  ) : patientHistory.length > 0 ? (
                    <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
                      {patientHistory.map((apt) => (
                        <div key={apt.id} className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <div className="text-sm font-bold text-gray-900">{apt.doctorName}</div>
                              <div className="text-xs text-gray-500 flex items-center mt-1">
                                <Calendar className="w-3 h-3 mr-1" />
                                {new Date(apt.date).toLocaleDateString()} at {apt.time}
                              </div>
                            </div>
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(apt.status)}`}>
                              {apt.status}
                            </span>
                          </div>
                          {apt.reason && (
                            <div className="text-sm text-gray-600 bg-gray-50 p-2 rounded">
                              <span className="font-medium text-xs text-gray-500 uppercase block mb-1">Reason</span>
                              {apt.reason}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                      <Calendar className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                      <p className="text-sm text-gray-500">No previous appointments found</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Book Appointment Modal */}
      {showBookModal && selectedPatient && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-lg w-full">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">
                  Book Appointment
                </h2>
                <button
                  onClick={() => setShowBookModal(false)}
                  className="text-gray-400 hover:text-gray-600 text-3xl leading-none"
                >
                  &times;
                </button>
              </div>

              <div className="bg-blue-50 p-4 rounded-lg mb-6">
                <div className="flex items-center gap-3 mb-1">
                  <User className="w-5 h-5 text-blue-600" />
                  <span className="font-medium text-blue-900">{selectedPatient.firstName} {selectedPatient.lastName}</span>
                </div>
                <div className="text-sm text-blue-700 ml-8">
                  {selectedPatient.phone} • {selectedPatient.email}
                </div>
              </div>

              <form onSubmit={handleBookingSubmit} className="space-y-4">
                <div>
                  <label className="form-label">Doctor</label>
                  <select
                    className="form-input"
                    value={bookingData.doctorId}
                    onChange={(e) => setBookingData({ ...bookingData, doctorId: e.target.value })}
                    required
                  >
                    <option value="">Select Doctor</option>
                    {doctors.map(doc => (
                      <option key={doc.id} value={doc.id}>{doc.name} - {doc.specialty}</option>
                    ))}
                  </select>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="form-label">Date</label>
                    <input
                      type="date"
                      className="form-input"
                      value={bookingData.date}
                      min={new Date().toISOString().split('T')[0]}
                      onChange={(e) => setBookingData({ ...bookingData, date: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">Time</label>
                    <select
                      className="form-input"
                      value={bookingData.time}
                      onChange={(e) => setBookingData({ ...bookingData, time: e.target.value })}
                      required
                    >
                      <option value="">Select Time</option>
                      <option value="09:00">09:00 AM</option>
                      <option value="09:30">09:30 AM</option>
                      <option value="10:00">10:00 AM</option>
                      <option value="10:30">10:30 AM</option>
                      <option value="11:00">11:00 AM</option>
                      <option value="11:30">11:30 AM</option>
                      <option value="14:00">02:00 PM</option>
                      <option value="14:30">02:30 PM</option>
                      <option value="15:00">03:00 PM</option>
                      <option value="15:30">03:30 PM</option>
                      <option value="16:00">04:00 PM</option>
                      <option value="16:30">04:30 PM</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="form-label">Reason for Visit</label>
                  <textarea
                    className="form-input"
                    rows={3}
                    placeholder="Describe symptoms or reason..."
                    value={bookingData.reason}
                    onChange={(e) => setBookingData({ ...bookingData, reason: e.target.value })}
                  />
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowBookModal(false)}
                    className="btn-secondary"
                    disabled={isBooking}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={isBooking}
                  >
                    {isBooking ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Booking...
                      </>
                    ) : (
                      'Confirm Booking'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Delete Patient Modal */}
      {showDeletePatientModal && selectedPatientToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex items-start">
              <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                <AlertCircle className="h-6 w-6 text-red-600" />
              </div>
              <div className="ml-4 text-left">
                <h3 className="text-lg leading-6 font-medium text-gray-900">
                  Delete Patient
                </h3>
                <div className="mt-2">
                  <p className="text-sm text-gray-500">
                    Are you sure you want to delete this patient? This action cannot be undone.
                  </p>
                </div>
              </div>
            </div>

            {deleteError && (
              <div className="mt-4 bg-red-50 p-3 rounded-md">
                <p className="text-sm text-red-700">{deleteError}</p>
              </div>
            )}

            <div className="mt-6 flex flex-col sm:flex-row-reverse gap-3">
              <button
                type="button"
                onClick={handleDeletePatient}
                disabled={isDeleting}
                className="btn-danger w-full sm:w-auto inline-flex justify-center"
              >
                {isDeleting ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4 mr-2" />
                )}
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDeletePatientModal(false)
                  setSelectedPatientToDelete(null)
                  setDeleteError(null)
                }}
                disabled={isDeleting}
                className="btn-secondary w-full sm:w-auto inline-flex justify-center"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  )
}