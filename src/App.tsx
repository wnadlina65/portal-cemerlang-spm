import React, { useState, useEffect } from 'react';
import { BookOpen, Search, FileText, Send, CheckCircle, BarChart2, Shield, X, Plus, LogOut, TrendingUp, AlertCircle, Star } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, updateDoc, doc, serverTimestamp } from 'firebase/firestore';

import firebaseConfig from '../firebase-applet-config.json';

// --- FIREBASE INITIALIZATION ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const appId = firebaseConfig.projectId;

// --- ERROR HANDLING ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- DATA PEMBELAJARAN & TETAPAN ---
const SENARAI_NEGERI = ["Johor", "Kedah", "Kelantan", "Melaka", "Negeri Sembilan", "Pahang", "Perak", "Perlis", "Pulau Pinang", "Sabah", "Sarawak", "Selangor", "Terengganu", "WP Kuala Lumpur", "MRSM", "SBP", "YIK"];
const SENARAI_KERTAS = ["Kertas 1", "Kertas 2", "Kertas 3", "Kertas 4"];
const SENARAI_TAHUN = ["2021", "2022", "2023", "2024", "2025", "2026"];

export default function App() {
  const [user, setUser] = useState<any>(null);
  
  // App State
  const [questions, setQuestions] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [isTeacher, setIsTeacher] = useState(false);
  const [showTeacherLogin, setShowTeacherLogin] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  
  // System Errors State
  const [dbError, setDbError] = useState(false);
  const [authError, setAuthError] = useState(false);
  
  // Student State
  const [filterTahun, setFilterTahun] = useState('');
  const [filterNegeri, setFilterNegeri] = useState('');
  const [filterKertas, setFilterKertas] = useState('');
  const [selectedQuestion, setSelectedQuestion] = useState<any>(null);
  
  const [studentForm, setStudentForm] = useState({ nama: '', maktab: '', kelas: '', bahagian: '', jawapan: '' });
  const [searchMaktab, setSearchMaktab] = useState('');
  const [notification, setNotification] = useState({ show: false, message: '', type: 'success' });

  // Teacher State
  const [newQuestion, setNewQuestion] = useState({ tahun: '2024', negeri: 'Selangor', kertas: 'Kertas 1', pautan: '' });
  const [gradingSubmission, setGradingSubmission] = useState<any>(null);
  const [gradingForm, setGradingForm] = useState({ bintang: '', kekuatan: '', kelemahan: '', intervensi: '' });
  const [teacherTab, setTeacherTab] = useState('semakan');

  // --- FIREBASE AUTHENTICATION ---
  const handleGoogleLogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      setAuthError(false);
      showToast("Berjaya Log Masuk dengan Google");
    } catch (err: any) {
      if (err.code === 'auth/popup-closed-by-user') {
        showToast("Log masuk dibatalkan.", "info");
      } else {
        console.error("Google Login Error:", err);
        showToast("Gagal Log Masuk dengan Google", "error");
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      // Wait for the initial auth state to be determined
      const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
        setUser(currentUser);
        
        if (!currentUser) {
          try {
            if (typeof window !== 'undefined' && (window as any).__initial_auth_token) {
              await signInWithCustomToken(auth, (window as any).__initial_auth_token);
            } else {
              await signInAnonymously(auth);
            }
          } catch (err: any) {
            // Only log if it's not a known configuration error
            if (err.code !== 'auth/operation-not-allowed' && err.code !== 'auth/admin-restricted-operation') {
              console.error("Auth error:", err);
            }
            
            if (err.code === 'auth/operation-not-allowed' || err.code === 'auth/admin-restricted-operation') {
              setAuthError(true);
            }
          }
        }
      });
      return unsubscribe;
    };
    
    const authUnsubscribePromise = initAuth();
    return () => {
      authUnsubscribePromise.then(unsub => unsub());
    };
  }, []);

  // --- FETCH DATA (QUESTIONS & SUBMISSIONS) ---
  useEffect(() => {
    if (!user) return;
    setDbError(false);

    // Fetch Questions
    const qPath = `artifacts/${appId}/public/data/questions`;
    const qRef = collection(db, qPath);
    const unsubQ = onSnapshot(qRef, (snapshot) => {
      const qData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setQuestions(qData);
    }, (err: any) => {
      console.error("Firebase Questions Error:", err);
      if (err.code === 'permission-denied' || (err.message && err.message.includes('permission'))) {
        setDbError(true);
      }
      handleFirestoreError(err, OperationType.GET, qPath);
    });

    // Fetch Submissions
    const sPath = `artifacts/${appId}/public/data/submissions`;
    const sRef = collection(db, sPath);
    const unsubS = onSnapshot(sRef, (snapshot) => {
      const sData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      sData.sort((a: any, b: any) => (b.timestamp?.toMillis() || 0) - (a.timestamp?.toMillis() || 0));
      setSubmissions(sData);
    }, (err: any) => {
      console.error("Firebase Submissions Error:", err);
      if (err.code === 'permission-denied' || (err.message && err.message.includes('permission'))) {
        setDbError(true);
      }
      handleFirestoreError(err, OperationType.GET, sPath);
    });

    return () => { unsubQ(); unsubS(); };
  }, [user]);

  // --- HELPER FUNCTIONS ---
  const showToast = (message: string, type: string = 'success') => {
    setNotification({ show: true, message, type });
    setTimeout(() => setNotification({ show: false, message: '', type: 'success' }), 3000);
  };

  const convertDriveLinkToPreview = (link: string) => {
    if (!link) return '';
    if (link.includes('/view')) return link.replace(/\/view.*/, '/preview');
    if (link.includes('/edit')) return link.replace(/\/edit.*/, '/preview');
    return link;
  };

  // --- STUDENT ACTIONS ---
  const handleStudentSubmit = async () => {
    if (!selectedQuestion) return showToast("Sila pilih soalan dahulu", "error");
    
    let bahagianWajib = false;
    if (selectedQuestion.kertas === 'Kertas 1' || selectedQuestion.kertas === 'Kertas 2' || selectedQuestion.kertas === 'Kertas 3') {
      bahagianWajib = true;
    }

    if (!studentForm.nama || !studentForm.maktab || !studentForm.kelas || !studentForm.jawapan || (bahagianWajib && !studentForm.bahagian)) {
      return showToast("Sila lengkapkan butiran, bahagian soalan dan jawapan anda.", "error");
    }

    try {
      const sPath = `artifacts/${appId}/public/data/submissions`;
      const sRef = collection(db, sPath);
      const infoBahagian = studentForm.bahagian ? ` [${studentForm.bahagian}]` : '';
      
      await addDoc(sRef, {
        questionId: selectedQuestion.id,
        soalanInfo: `${selectedQuestion.negeri} - ${selectedQuestion.kertas} (${selectedQuestion.tahun})${infoBahagian}`,
        nama: studentForm.nama,
        maktab: studentForm.maktab,
        kelas: studentForm.kelas,
        bahagian: studentForm.bahagian,
        jawapan: studentForm.jawapan,
        status: 'Dihantar',
        bintang: null,
        komen: null,
        timestamp: serverTimestamp()
      });
      setStudentForm({ ...studentForm, bahagian: '', jawapan: '' });
      showToast("Jawapan berjaya dihantar! Sila rujuk ruangan arkib.");
    } catch (error: any) {
      console.error(error);
      if (error.code === 'permission-denied' || (error.message && error.message.includes('permission'))) {
        showToast("Gagal dihantar: Sila baiki 'Firestore Rules' di Firebase.", "error");
      } else {
        showToast("Gagal menghantar jawapan.", "error");
      }
      const sPath = `artifacts/${appId}/public/data/submissions`;
      handleFirestoreError(error, OperationType.WRITE, sPath);
    }
  };

  // --- TEACHER ACTIONS ---
  const handleTeacherLogin = (e: any) => {
    e.preventDefault();
    const pwd = e.target.password.value;
    if (pwd === 'GuruBMcuba') {
      setIsTeacher(true);
      setShowTeacherLogin(false);
      showToast("Berjaya Log Masuk sebagai Guru");
    } else {
      showToast("Kata laluan salah!", "error");
    }
  };

  const handleAddQuestion = async () => {
    if (!newQuestion.pautan) return showToast("Sila masukkan pautan Google Drive", "error");
    const qPath = `artifacts/${appId}/public/data/questions`;
    try {
      const qRef = collection(db, qPath);
      await addDoc(qRef, {
        ...newQuestion,
        timestamp: serverTimestamp()
      });
      setNewQuestion({ ...newQuestion, pautan: '' });
      showToast("Soalan baharu berjaya ditambah!");
    } catch (error: any) {
      if (error.code === 'permission-denied' || (error.message && error.message.includes('permission'))) {
        showToast("Gagal: Akses Firebase disekat.", "error");
      } else {
        showToast("Ralat menambah soalan.", "error");
      }
      handleFirestoreError(error, OperationType.WRITE, qPath);
    }
  };

  const saveGrading = async () => {
    if (!gradingSubmission) return;
    if (!gradingForm.bintang) return showToast("Sila pilih penilaian bintang.", "error");
    const sPath = `artifacts/${appId}/public/data/submissions/${gradingSubmission.id}`;
    try {
      const docRef = doc(db, sPath);
      await updateDoc(docRef, {
        status: 'Disemak',
        bintang: gradingForm.bintang,
        komen: {
          kekuatan: gradingForm.kekuatan,
          kelemahan: gradingForm.kelemahan,
          intervensi: gradingForm.intervensi
        },
        disemakPada: serverTimestamp()
      });
      setGradingSubmission(null);
      showToast("Semakan berjaya direkodkan!");
    } catch (error: any) {
      if (error.code === 'permission-denied' || (error.message && error.message.includes('permission'))) {
        showToast("Gagal menyimpan: Akses Firebase disekat.", "error");
      } else {
        showToast("Ralat menyimpan semakan.", "error");
      }
      handleFirestoreError(error, OperationType.WRITE, sPath);
    }
  };

  const filteredQuestions = questions.filter(q => {
    return (!filterTahun || q.tahun === filterTahun) &&
           (!filterNegeri || q.negeri === filterNegeri) &&
           (!filterKertas || q.kertas === filterKertas);
  });

  const studentArchive = searchMaktab ? submissions.filter(s => s.maktab === searchMaktab) : [];

  // Component to render stars safely
  const RenderStars = ({ count }: { count: any }) => {
    const stars = [];
    const num = parseInt(count) || 0;
    for (let i = 0; i < num; i++) stars.push(<Star key={i} className="text-yellow-500 fill-current inline-block" size={18} />);
    for (let i = num; i < 6; i++) stars.push(<Star key={`e${i}`} className="text-slate-300 inline-block" size={18} />);
    return <div className="flex space-x-1">{stars}</div>;
  };

  // --- RENDERERS ---
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans">
      {/* HEADER */}
      <header className="bg-blue-800 text-white shadow-md sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <div 
            className="flex items-center space-x-3 cursor-pointer select-none"
            onDoubleClick={() => !isTeacher && setShowTeacherLogin(true)}
            title="Dwiklik untuk akses guru"
          >
            <BookOpen size={28} className="text-yellow-400" />
            <div>
              <h1 className="text-xl font-bold leading-tight">Portal Cemerlang SPM</h1>
              <p className="text-xs text-blue-200">Latihan & Unjuran Prestasi</p>
            </div>
          </div>
          {isTeacher && (
            <button 
              onClick={() => setIsTeacher(false)}
              className="flex items-center space-x-1 text-sm bg-blue-700 hover:bg-blue-600 px-3 py-1.5 rounded transition-colors"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">Log Keluar Guru</span>
            </button>
          )}
        </div>
      </header>

      {/* Ralat Auth Firebase */}
      {authError && (
        <div className="bg-orange-100 border-l-4 border-orange-500 text-orange-900 p-6 mx-4 mt-4 rounded-xl shadow-lg max-w-7xl md:mx-auto">
          <div className="flex items-start space-x-4">
            <div className="bg-orange-500 p-2 rounded-full text-white">
              <Shield size={24} />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-xl">Akses Terhad (Authentication Required)</h3>
              <p className="mt-2 text-sm leading-relaxed">
                Sistem tidak dapat log masuk sebagai "Pelawat" secara automatik kerana tetapan keselamatan Firebase. 
                Sila pilih salah satu cara di bawah untuk meneruskan:
              </p>
              
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button 
                  onClick={handleGoogleLogin}
                  disabled={isLoggingIn}
                  className={`bg-white border-2 border-slate-200 text-slate-700 px-6 py-3 rounded-xl font-bold flex items-center justify-center transition-all shadow-sm group ${isLoggingIn ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50 hover:border-blue-400'}`}
                >
                  <img src="https://www.gstatic.com/firebase/anonymous-scan.png" className={`w-6 h-6 mr-3 ${isLoggingIn ? '' : 'group-hover:scale-110'} transition-transform`} alt="Google" referrerPolicy="no-referrer" />
                  {isLoggingIn ? 'Sila tunggu...' : 'Log Masuk dengan Google'}
                </button>
                
                <div className="bg-white/50 p-4 rounded-xl border border-orange-200 text-xs text-orange-800">
                  <p className="font-bold mb-1 flex items-center"><AlertCircle size={14} className="mr-1" /> Nota untuk Pentadbir:</p>
                  <p>Untuk membenarkan log masuk pelawat (Anonymous Auth), sila aktifkan di:</p>
                  <p className="mt-1 font-mono bg-orange-200/50 p-1 rounded">Firebase Console &gt; Authentication &gt; Sign-in method &gt; Anonymous</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {!user && !authError && (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-800"></div>
          <p className="mt-4 text-slate-500">Memulakan sistem pengesahan...</p>
        </div>
      )}

      {user && (
        <>

      {/* Ralat Kebenaran Firebase (Permission Denied) */}
      {dbError && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-900 p-4 mx-4 mt-4 rounded shadow-sm max-w-7xl md:mx-auto">
          <h3 className="font-bold text-lg flex items-center"><AlertCircle className="mr-2" size={20}/> Akses Pangkalan Data Disekat (Missing Permissions)</h3>
          <p className="mt-1 text-sm">Firebase cikgu sedang menghalang sistem daripada membaca atau menyimpan jawapan pelajar kerana tetapan <b>Firestore Rules</b> masih tertutup.</p>
          <p className="mt-2 font-semibold text-sm">Cara membaikinya di Firebase Console:</p>
          <ol className="list-decimal ml-5 text-sm mt-1">
            <li>Buka Firebase Console &gt; Build &gt; Firestore Database &gt; Pilih tab <b>Rules</b>.</li>
            <li>Padam semua kod di dalam ruangan tersebut dan tampalkan kod baharu di bawah ini:</li>
          </ol>
          <code className="block bg-white text-red-800 p-3 mt-3 rounded font-mono text-sm border border-red-200">
            rules_version = '2';<br/>
            service cloud.firestore {'{'}<br/>
            &nbsp;&nbsp;match /databases/{'{database}'}/documents {'{'}<br/>
            &nbsp;&nbsp;&nbsp;&nbsp;match /{'{document=**}'} {'{'}<br/>
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;allow read, write: if true;<br/>
            &nbsp;&nbsp;&nbsp;&nbsp;{'}'}<br/>
            &nbsp;&nbsp;{'}'}<br/>
            {'}'}
          </code>
          <p className="mt-3 text-sm font-semibold">Selepas itu, klik butang <b>Publish</b> dan muat semula (refresh) portal ini.</p>
        </div>
      )}

      {/* TOAST NOTIFICATION */}
      {notification.show && (
        <div className={`fixed top-16 left-1/2 transform -translate-x-1/2 z-50 px-4 py-2 rounded shadow-lg flex items-center space-x-2 transition-all ${notification.type === 'error' ? 'bg-red-500 text-white' : 'bg-green-500 text-white'}`}>
          {notification.type === 'error' ? <AlertCircle size={18}/> : <CheckCircle size={18}/>}
          <span>{notification.message}</span>
        </div>
      )}

      {/* MODAL LOGIN GURU */}
      {showTeacherLogin && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white p-6 rounded-xl shadow-2xl w-full max-w-sm">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold flex items-center text-blue-800"><Shield className="mr-2" size={20}/> Akses Guru</h2>
              <button onClick={() => setShowTeacherLogin(false)} className="text-slate-400 hover:text-red-500"><X size={20}/></button>
            </div>
            <form onSubmit={handleTeacherLogin}>
              <div className="mb-4">
                <label className="block text-sm font-semibold mb-1 text-slate-600">Kata Laluan Backdoor</label>
                <input 
                  type="password" 
                  name="password"
                  className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Masukkan kata laluan"
                  autoFocus
                />
              </div>
              <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded transition-colors">
                Log Masuk
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL SEMAKAN GURU */}
      {gradingSubmission && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl my-8 flex flex-col max-h-[90vh]">
            <div className="p-4 border-b bg-blue-50 flex justify-between items-center rounded-t-xl shrink-0">
              <h2 className="text-lg font-bold text-blue-800">Semakan Jawapan: {gradingSubmission.nama}</h2>
              <button onClick={() => setGradingSubmission(null)} className="text-slate-400 hover:text-red-500"><X size={24}/></button>
            </div>
            <div className="p-4 overflow-y-auto flex-grow">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <div className="mb-4 bg-slate-50 p-4 rounded border">
                    <p className="text-xs text-slate-500 mb-1">Soalan: {gradingSubmission.soalanInfo}</p>
                    <p className="text-sm font-semibold mb-2">Jawapan Pelajar:</p>
                    <p className="text-sm whitespace-pre-wrap text-slate-700">{gradingSubmission.jawapan}</p>
                  </div>
                  <div className="bg-yellow-50 p-3 rounded text-xs text-yellow-800 border border-yellow-200">
                    <p className="font-bold mb-1 flex items-center"><Star size={14} className="mr-1 fill-current" /> Panduan Bintang (1-6):</p>
                    <p>Berikan penilaian keseluruhan kualiti jawapan dari 1 Bintang (Sangat Lemah) hingga 6 Bintang (Cemerlang).</p>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold mb-1">Penilaian (Bintang 1-6)</label>
                    <select 
                      className="w-full border p-2 rounded text-lg bg-yellow-50 focus:ring-2 focus:ring-yellow-500 outline-none"
                      value={gradingForm.bintang}
                      onChange={(e) => setGradingForm({...gradingForm, bintang: e.target.value})}
                    >
                      <option value="">-- Pilih Bintang --</option>
                      {[1, 2, 3, 4, 5, 6].map(b => <option key={b} value={b}>{b} Bintang</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-1 text-green-700">Kekuatan</label>
                    <textarea 
                      className="w-full border p-2 rounded text-sm min-h-[60px]"
                      value={gradingForm.kekuatan}
                      onChange={(e) => setGradingForm({...gradingForm, kekuatan: e.target.value})}
                      placeholder="Cth: Laras bahasa yang baik..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-1 text-red-700">Kelemahan</label>
                    <textarea 
                      className="w-full border p-2 rounded text-sm min-h-[60px]"
                      value={gradingForm.kelemahan}
                      onChange={(e) => setGradingForm({...gradingForm, kelemahan: e.target.value})}
                      placeholder="Cth: Huraian kurang matang..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-1 text-blue-700">Cadangan Intervensi</label>
                    <textarea 
                      className="w-full border p-2 rounded text-sm min-h-[60px]"
                      value={gradingForm.intervensi}
                      onChange={(e) => setGradingForm({...gradingForm, intervensi: e.target.value})}
                      placeholder="Cth: Perbanyakkan bacaan isu semasa..."
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="p-4 border-t bg-slate-50 flex justify-end shrink-0">
              <button 
                onClick={saveGrading}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded font-semibold flex items-center"
              >
                <CheckCircle size={18} className="mr-2" /> Simpan Semakan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MAIN CONTENT AREA */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        
        {/* =========================================
            TEACHER DASHBOARD
            ========================================= */}
        {isTeacher ? (
          <div className="space-y-6">
            <div className="flex space-x-2 border-b border-slate-200">
              <button 
                className={`py-2 px-4 font-semibold transition-colors ${teacherTab === 'semakan' ? 'border-b-2 border-blue-600 text-blue-700' : 'text-slate-500 hover:text-slate-800'}`}
                onClick={() => setTeacherTab('semakan')}
              >
                Arkib & Semakan Pelajar
              </button>
              <button 
                className={`py-2 px-4 font-semibold transition-colors ${teacherTab === 'soalan' ? 'border-b-2 border-blue-600 text-blue-700' : 'text-slate-500 hover:text-slate-800'}`}
                onClick={() => setTeacherTab('soalan')}
              >
                Pengurusan Soalan
              </button>
            </div>

            {teacherTab === 'soalan' && (
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <h3 className="text-lg font-bold mb-4 flex items-center"><Plus size={20} className="mr-2 text-blue-600"/> Tambah Bahan Soalan (Pautan Google Drive)</h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-slate-500">Tahun</label>
                    <select className="w-full border rounded p-2 text-sm" value={newQuestion.tahun} onChange={(e) => setNewQuestion({...newQuestion, tahun: e.target.value})}>
                      {SENARAI_TAHUN.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-slate-500">Negeri/Sekolah</label>
                    <select className="w-full border rounded p-2 text-sm" value={newQuestion.negeri} onChange={(e) => setNewQuestion({...newQuestion, negeri: e.target.value})}>
                      {SENARAI_NEGERI.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-slate-500">Kertas</label>
                    <select className="w-full border rounded p-2 text-sm" value={newQuestion.kertas} onChange={(e) => setNewQuestion({...newQuestion, kertas: e.target.value})}>
                      {SENARAI_KERTAS.map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-slate-500">Pautan Google Drive (PDF)</label>
                    <input 
                      type="text" 
                      className="w-full border rounded p-2 text-sm" 
                      placeholder="https://drive.google.com/file/d/..."
                      value={newQuestion.pautan}
                      onChange={(e) => setNewQuestion({...newQuestion, pautan: e.target.value})}
                    />
                  </div>
                </div>
                <button onClick={handleAddQuestion} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-semibold transition-colors">
                  Simpan Soalan
                </button>
                
                <div className="mt-8">
                  <h4 className="font-bold text-slate-700 mb-2">Senarai Soalan Sedia Ada ({questions.length})</h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm text-left text-slate-600">
                      <thead className="bg-slate-100 uppercase text-xs">
                        <tr>
                          <th className="px-4 py-2">Tahun</th>
                          <th className="px-4 py-2">Sumber</th>
                          <th className="px-4 py-2">Kertas</th>
                          <th className="px-4 py-2">Pautan</th>
                        </tr>
                      </thead>
                      <tbody>
                        {questions.map(q => (
                          <tr key={q.id} className="border-b">
                            <td className="px-4 py-2">{q.tahun}</td>
                            <td className="px-4 py-2">{q.negeri}</td>
                            <td className="px-4 py-2">{q.kertas}</td>
                            <td className="px-4 py-2"><a href={q.pautan} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline flex items-center"><FileText size={14} className="mr-1"/> Buka PDF</a></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {teacherTab === 'semakan' && (
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <h3 className="text-lg font-bold mb-4 flex items-center"><CheckCircle size={20} className="mr-2 text-green-600"/> Arkib & Semakan Jawapan Pelajar</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm text-left text-slate-700">
                    <thead className="bg-slate-100 uppercase text-xs text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Tarikh Hantar</th>
                        <th className="px-4 py-3">Nama Pelajar</th>
                        <th className="px-4 py-3">Kelas / No Maktab</th>
                        <th className="px-4 py-3">Latihan</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-center">Tindakan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {submissions.map(s => (
                        <tr key={s.id} className="border-b hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3">{s.timestamp?.toDate().toLocaleString('ms-MY') || 'Baru'}</td>
                          <td className="px-4 py-3 font-semibold">{s.nama}</td>
                          <td className="px-4 py-3">{s.kelas} <br/><span className="text-xs text-slate-400">{s.maktab}</span></td>
                          <td className="px-4 py-3">{s.soalanInfo}</td>
                          <td className="px-4 py-3">
                            {s.status === 'Disemak' ? 
                              <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-bold flex items-center w-fit">Disemak ({s.bintang} <Star size={12} className="ml-0.5 fill-current"/>)</span> : 
                              <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs font-bold">Menunggu</span>
                            }
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button 
                              onClick={() => {
                                setGradingSubmission(s);
                                setGradingForm({
                                  bintang: s.bintang || '',
                                  kekuatan: s.komen?.kekuatan || '',
                                  kelemahan: s.komen?.kelemahan || '',
                                  intervensi: s.komen?.intervensi || ''
                                });
                              }}
                              className="text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded text-xs font-semibold shadow-sm transition-colors"
                            >
                              Semak / Lihat
                            </button>
                          </td>
                        </tr>
                      ))}
                      {submissions.length === 0 && (
                        <tr><td colSpan={6} className="text-center py-6 text-slate-400">Belum ada rekod jawapan dihantar.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : (
          
        /* =========================================
            STUDENT DASHBOARD
            ========================================= */
          <div className="space-y-6">
            
            {/* SECTION: PEMILIHAN SOALAN */}
            <section className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
              <h2 className="text-lg font-bold mb-4 text-slate-800 flex items-center">
                <Search className="mr-2 text-blue-600" size={20} /> Cari Koleksi Soalan Percubaan
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-semibold mb-1 text-slate-500">Tahun</label>
                  <select className="w-full border rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50" value={filterTahun} onChange={(e) => setFilterTahun(e.target.value)}>
                    <option value="">Semua Tahun</option>
                    {SENARAI_TAHUN.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-slate-500">Negeri / Sekolah Khas</label>
                  <select className="w-full border rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50" value={filterNegeri} onChange={(e) => setFilterNegeri(e.target.value)}>
                    <option value="">Semua Lokasi</option>
                    {SENARAI_NEGERI.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-slate-500">Jenis Kertas</label>
                  <select className="w-full border rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50" value={filterKertas} onChange={(e) => setFilterKertas(e.target.value)}>
                    <option value="">Semua Kertas</option>
                    {SENARAI_KERTAS.map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
              </div>
              
              {/* Hasil Carian Soalan */}
              <div className="flex flex-wrap gap-2">
                {filteredQuestions.length > 0 ? (
                  filteredQuestions.map(q => (
                    <button
                      key={q.id}
                      onClick={() => {
                        setSelectedQuestion(q);
                        setStudentForm(prev => ({...prev, bahagian: '', jawapan: ''})); // Reset pilihan bila tukar kertas
                      }}
                      className={`px-3 py-2 rounded-lg text-sm font-medium border transition-all ${selectedQuestion?.id === q.id ? 'bg-blue-600 text-white border-blue-600 shadow-md transform scale-105' : 'bg-white text-slate-700 hover:bg-slate-100 border-slate-300'}`}
                    >
                      {q.negeri} - {q.kertas} ({q.tahun})
                    </button>
                  ))
                ) : (
                  <p className="text-sm text-red-500 italic">Tiada soalan dijumpai untuk carian ini. Sila hubungi guru anda.</p>
                )}
              </div>
            </section>

            {/* SECTION: WORKSPACE (SPLIT VIEW) */}
            {selectedQuestion && (
              <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col md:flex-row h-auto md:h-[700px]">
                
                {/* PDF Viewer (Left) */}
                <div className="w-full md:w-1/2 bg-slate-200 flex flex-col border-r border-slate-200">
                  <div className="bg-slate-100 p-3 text-sm font-semibold text-slate-700 border-b flex justify-between items-center">
                    <span className="flex items-center"><FileText size={16} className="mr-2 text-blue-600"/> Paparan Soalan</span>
                    <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs">{selectedQuestion.negeri} {selectedQuestion.tahun}</span>
                  </div>
                  <div className="flex-grow relative h-[400px] md:h-auto">
                    {selectedQuestion.pautan ? (
                      <iframe 
                        src={convertDriveLinkToPreview(selectedQuestion.pautan)} 
                        className="absolute inset-0 w-full h-full"
                        title="PDF Soalan"
                        allow="autoplay"
                      ></iframe>
                    ) : (
                      <div className="flex h-full items-center justify-center text-slate-400">Tiada pautan PDF</div>
                    )}
                  </div>
                </div>

                {/* Answer Workspace (Right) */}
                <div className="w-full md:w-1/2 flex flex-col bg-white">
                  <div className="bg-blue-50 p-3 text-sm font-semibold text-blue-800 border-b flex items-center">
                    <Send size={16} className="mr-2"/> Ruang Jawapan Pelajar
                  </div>
                  <div className="p-4 flex-grow overflow-y-auto space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold mb-1">Nama Penuh</label>
                        <input type="text" className="w-full border rounded p-2 text-sm bg-slate-50" placeholder="Ali bin Abu" value={studentForm.nama} onChange={e=>setStudentForm({...studentForm, nama: e.target.value})} />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1">No. Maktab</label>
                        <input type="text" className="w-full border rounded p-2 text-sm bg-slate-50" placeholder="MS22..." value={studentForm.maktab} onChange={e=>setStudentForm({...studentForm, maktab: e.target.value})} />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-semibold mb-1">Kelas</label>
                        <input type="text" className="w-full border rounded p-2 text-sm bg-slate-50" placeholder="5 Sains 1" value={studentForm.kelas} onChange={e=>setStudentForm({...studentForm, kelas: e.target.value})} />
                      </div>

                      {/* Dynamic Field Based on Kertas */}
                      {selectedQuestion.kertas === 'Kertas 1' && (
                        <div className="col-span-2">
                          <label className="block text-xs font-semibold mb-1 text-blue-700">Pilihan Karangan (Wajib)</label>
                          <select className="w-full border rounded p-2 text-sm bg-slate-50 outline-none focus:ring-2 focus:ring-blue-500" value={studentForm.bahagian} onChange={e=>setStudentForm({...studentForm, bahagian: e.target.value})}>
                            <option value="">-- Sila Pilih --</option>
                            <option value="Karangan A">Karangan A</option>
                            <option value="Karangan B">Karangan B</option>
                          </select>
                        </div>
                      )}
                      {selectedQuestion.kertas === 'Kertas 2' && (
                        <div className="col-span-2">
                          <label className="block text-xs font-semibold mb-1 text-blue-700">Pilihan Soalan (Wajib)</label>
                          <select className="w-full border rounded p-2 text-sm bg-slate-50 outline-none focus:ring-2 focus:ring-blue-500" value={studentForm.bahagian} onChange={e=>setStudentForm({...studentForm, bahagian: e.target.value})}>
                            <option value="">-- Sila Pilih (Soalan 1 hingga 9) --</option>
                            {[1,2,3,4,5,6,7,8,9].map(num => <option key={num} value={`Soalan ${num}`}>Soalan {num}</option>)}
                          </select>
                        </div>
                      )}
                      {selectedQuestion.kertas === 'Kertas 3' && (
                        <div className="col-span-2">
                          <label className="block text-xs font-semibold mb-1 text-blue-700">Jenis Ujian (Wajib)</label>
                          <select className="w-full border rounded p-2 text-sm bg-slate-50 outline-none focus:ring-2 focus:ring-blue-500" value={studentForm.bahagian} onChange={e=>setStudentForm({...studentForm, bahagian: e.target.value})}>
                            <option value="">-- Sila Pilih --</option>
                            <option value="Individu">Individu</option>
                            <option value="Berkumpulan">Berkumpulan</option>
                          </select>
                        </div>
                      )}
                    </div>
                    
                    <div className="flex flex-col h-64 md:h-[350px]">
                      <label className="block text-xs font-semibold mb-1">Taip Jawapan Anda di Sini</label>
                      <textarea 
                        className="w-full flex-grow border rounded-lg p-3 text-sm resize-none focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="1. a) Berdasarkan petikan..."
                        value={studentForm.jawapan}
                        onChange={e=>setStudentForm({...studentForm, jawapan: e.target.value})}
                      ></textarea>
                    </div>

                    <button 
                      onClick={handleStudentSubmit}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg shadow-md transition-all flex justify-center items-center"
                    >
                      <Send size={18} className="mr-2"/> Hantar Jawapan
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* SECTION: ARKIB & PRESTASI */}
            <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
              <h2 className="text-lg font-bold mb-4 text-slate-800 flex items-center">
                <TrendingUp className="mr-2 text-green-600" size={20} /> Arkib Jawapan & Unjuran Prestasi
              </h2>
              <div className="bg-slate-50 p-4 rounded-lg border mb-6 flex flex-col md:flex-row gap-4 items-center">
                <div className="flex-grow w-full">
                  <label className="block text-sm font-semibold mb-1">Masukkan No. Maktab untuk carian rekod:</label>
                  <div className="flex">
                    <input 
                      type="text" 
                      className="w-full border rounded-l-lg p-2 outline-none focus:border-blue-500" 
                      placeholder="Cth: MS22101..."
                      value={searchMaktab}
                      onChange={(e) => setSearchMaktab(e.target.value)}
                    />
                    <button className="bg-slate-800 text-white px-4 py-2 rounded-r-lg font-semibold hover:bg-slate-700">Semak</button>
                  </div>
                </div>
              </div>

              {searchMaktab && (
                <div className="space-y-6">
                  {/* CHART UNJURAN */}
                  {studentArchive.length > 0 ? (
                    <div className="bg-white border rounded-lg p-4">
                      <h3 className="font-bold text-sm mb-4 text-slate-700 flex items-center"><BarChart2 size={16} className="mr-1"/> Graf Prestasi Terkini</h3>
                      <div className="flex items-end h-40 gap-2 border-b border-l pb-1 pl-1">
                        {studentArchive.slice(0,10).reverse().map((s, idx) => {
                          const mark = s.bintang ? parseInt(s.bintang) : 0;
                          const heightPct = s.bintang ? Math.max(10, (mark/6)*100) : 5;
                          const isGraded = s.status === 'Disemak';
                          return (
                            <div key={idx} className="flex flex-col items-center flex-1 group relative">
                              {isGraded && (
                                <span className="absolute -top-6 text-xs font-bold text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-100 p-1 rounded shadow-sm z-10 whitespace-nowrap">
                                  {mark} ⭐
                                </span>
                              )}
                              <div 
                                className={`w-full max-w-[40px] rounded-t-sm transition-all ${isGraded ? 'bg-yellow-400 hover:bg-yellow-500' : 'bg-slate-200'}`} 
                                style={{ height: `${heightPct}%` }}
                              ></div>
                              <span className="text-[10px] mt-1 text-slate-500 truncate w-full text-center" title={s.soalanInfo}>{s.soalanInfo.split(' ')[0]}</span>
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-xs text-center text-slate-400 mt-2">*Skala berdasarkan 6 Bintang. Hover pada graf untuk melihat skor.</p>
                    </div>
                  ) : (
                     <p className="text-sm text-slate-500 text-center py-4">Tiada rekod dijumpai untuk No. Maktab ini.</p>
                  )}

                  {/* SENARAI ARKIB */}
                  <div className="space-y-4">
                    {studentArchive.map((s) => {
                      return (
                        <div key={s.id} className="border border-slate-200 rounded-lg p-4 bg-white shadow-sm hover:shadow transition-shadow">
                          <div className="flex justify-between items-start mb-3 border-b pb-2">
                            <div>
                              <h4 className="font-bold text-slate-800">{s.soalanInfo}</h4>
                              <p className="text-xs text-slate-500">Dihantar pada: {s.timestamp?.toDate().toLocaleString('ms-MY')}</p>
                            </div>
                            <div className="text-right">
                              {s.status === 'Disemak' ? (
                                <div className="inline-block bg-yellow-50 text-yellow-800 px-3 py-1.5 rounded-lg border border-yellow-200 text-center shadow-sm">
                                  <RenderStars count={s.bintang} />
                                  <p className="text-[10px] font-bold mt-1 uppercase text-yellow-700">Penilaian Guru</p>
                                </div>
                              ) : (
                                <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs font-bold border border-slate-200">Menunggu Semakan</span>
                              )}
                            </div>
                          </div>
                          
                          {s.status === 'Disemak' && s.komen && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                              <div className="bg-green-50 border border-green-100 p-2 rounded">
                                <p className="text-xs font-bold text-green-800 mb-1">Kekuatan:</p>
                                <p className="text-xs text-green-900">{s.komen.kekuatan || '-'}</p>
                              </div>
                              <div className="bg-red-50 border border-red-100 p-2 rounded">
                                <p className="text-xs font-bold text-red-800 mb-1">Kelemahan:</p>
                                <p className="text-xs text-red-900">{s.komen.kelemahan || '-'}</p>
                              </div>
                              <div className="bg-blue-50 border border-blue-100 p-2 rounded">
                                <p className="text-xs font-bold text-blue-800 mb-1">Intervensi (Cadangan Guru):</p>
                                <p className="text-xs text-blue-900">{s.komen.intervensi || '-'}</p>
                              </div>
                            </div>
                          )}
                          
                          <details className="mt-3 text-sm">
                            <summary className="text-blue-600 cursor-pointer text-xs font-semibold outline-none">Lihat Jawapan Anda</summary>
                            <div className="mt-2 p-3 bg-slate-50 border rounded text-slate-700 whitespace-pre-wrap text-sm">
                              {s.jawapan}
                            </div>
                          </details>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
        </main>
        </>
      )}
    </div>
  );
}
