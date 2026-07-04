// --- 1. CẤU HÌNH FIREBASE ---
const firebaseConfig = {
    apiKey: "AIzaSyDyIvKhuxDw8uP1RmMutvdGd1o042XKYAM",
    authDomain: "multiple-choice-6704b.firebaseapp.com",
    projectId: "multiple-choice-6704b",
    storageBucket: "multiple-choice-6704b.firebasestorage.app",
    messagingSenderId: "1093935852039",
    appId: "1:1093935852039:web:8a0788e9252285b39518a2"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// [VIP TỐI ƯU HIỆU NĂNG] Kích hoạt bộ nhớ đệm (Cache) để tải chớp nhoáng
firebase.firestore().enablePersistence({
    synchronizeTabs: true
}).catch(function(err) {
    console.warn("Lỗi Cache: ", err.code);
});

// =========================================================================
// QUẢN TRỊ VIÊN HỆ THỐNG
// =========================================================================
const MASTER_ADMIN_UID = "bYMI3W1wh9Rzhc5AFXpIpYnWuJ13";

function checkIsMasterAdmin() {
    return auth.currentUser && auth.currentUser.uid === MASTER_ADMIN_UID;
}

// --- 2. BIẾN TOÀN CỤC CỦA HỆ THỐNG ---
let quizDatabase = []; 
let historyDatabase = []; 
let pinnedFolders = []; 
let isHistoryLoaded = false; 
let isQuizzesLoaded = false;
let activeQuiz = null; 
let currentQuestionIndex = 0;
let studentName = "";
let isPracticeMode = false, isReviewMode = false;
let tabSwitchCount = 0, timerInterval, timeLeft = 0;
let userAnswers = [], flaggedQuestions = [];
let editingQuizId = null; 
let currentRole = 'student';
let currentFilter = 'all'; 
let isLoginMode = true; 
let currentSelectedCategory = ""; 
let currentStudentTab = "browse"; 
let screens = {}; 

let currentPlan = localStorage.getItem('cachedPlan') || 'basic'; // [VIP] Kim bài ghi nhớ gói cước tức thì
let mockGeneratedThisMonth = 0;
let lastMockMonth = null;
let isSharedMode = false; 
let lastPinnedStr = ""; 
let teacherQuizListener = null;
let studentQuizListener = null; 

// --- 3. THEO DÕI TRẠNG THÁI & KHỞI TẠO AN TOÀN ---
// [VIP] Khôi phục trí nhớ Sáng/Tối ngay khi load Web
if (localStorage.getItem('theme') === 'dark') {
    document.documentElement.classList.add('dark');
}
document.addEventListener("DOMContentLoaded", () => { 
    screens = {
        auth: document.getElementById('auth-screen'),
        home: document.getElementById('home-screen'),
        subjectDetail: document.getElementById('subject-detail-screen'),
        welcome: document.getElementById('welcome-screen'),
        quiz: document.getElementById('quiz-screen'),
        result: document.getElementById('result-screen'),
        admin: document.getElementById('admin-zone'),
        pricing: document.getElementById('pricing-screen')
    };
// Đồng bộ icon giao diện lúc vừa tải trang
    const themeIcon = document.getElementById('theme-icon');
    if (themeIcon) themeIcon.className = document.documentElement.classList.contains('dark') ? 'fas fa-sun text-lg sm:text-xl' : 'fas fa-moon text-lg sm:text-xl';
    setupEventListeners(); 
    setupHighlighting(); 
    
    auth.onAuthStateChanged((user) => {
        if (user) {
            if (user.displayName) {
                const nameEl = document.getElementById('student-name');
                if(nameEl) nameEl.value = user.displayName;
           }
            setRole('student');
            
            // [VÁ LỖI CẤP TỐC] Ngăn máy chủ tải toàn bộ dữ liệu nếu đang mở link chia sẻ
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('quiz') || (urlParams.get('folder') && urlParams.get('t'))) {
                isSharedMode = true; // Khóa ngay lập tức việc tải dữ liệu nền
            } else {
                fetchQuizzesFromFirebase(); 
            }
            fetchHistoryFromFirebase();
            
            db.collection("users").doc(user.uid).onSnapshot(doc => {
                if(doc.exists) {
                   currentPlan = doc.data().plan || 'basic';
                if (checkIsMasterAdmin()) currentPlan = 'ultra';

                localStorage.setItem('cachedPlan', currentPlan); // <--- [VIP] Kim bài chống giật lùi gói cước

                mockGeneratedThisMonth = doc.data().mockGeneratedThisMonth || 0;
                    lastMockMonth = doc.data().lastMockMonth || null;
                    
                    let currentMonth = new Date().getMonth();
                    if(lastMockMonth !== currentMonth) {
                        mockGeneratedThisMonth = 0;
                        lastMockMonth = currentMonth;
                        db.collection("users").doc(user.uid).update({mockGeneratedThisMonth: 0, lastMockMonth: currentMonth});
                    }
                    
                    if (typeof updatePlanBadge === 'function') updatePlanBadge();
                    
                    let currentPinnedStr = JSON.stringify(doc.data().pinnedFolders || []);
                    if (lastPinnedStr !== currentPinnedStr) {
                        lastPinnedStr = currentPinnedStr;
                        pinnedFolders = doc.data().pinnedFolders || []; 
                        
                        if (currentRole === 'student') {
                            fetchStudentPinnedQuizzes(); 
                        }
                    }
                } else {
                    currentPlan = checkIsMasterAdmin() ? 'ultra' : 'basic';
                    db.collection("users").doc(user.uid).set({
                        email: user.email.toLowerCase(),
                        plan: currentPlan,
                        mockGeneratedThisMonth: 0,
                        lastMockMonth: new Date().getMonth(),
                        pinnedFolders: []
                    }, {merge: true});
                    if (typeof updatePlanBadge === 'function') updatePlanBadge();
                }
            });

            const quizIdParam = urlParams.get('quiz');
            const folderParam = urlParams.get('folder');
            const teacherParam = urlParams.get('t');

            if (quizIdParam) {
                checkUrlForSharedQuiz(quizIdParam);
            } else if (folderParam && teacherParam) {
                loadSharedFolder(folderParam, teacherParam);
            } else {
                switchScreen('home'); 
            }
        } else {
            switchScreen('auth');
            toggleAuthMode(true); 
        }
    });
});

function checkFeatureAccess(feature, silent = false) {
    if (checkIsMasterAdmin()) return true; 

    const plans = {
        'basic': ['highlight', 'fullscreen'],
        'plus': ['highlight', 'fullscreen', 'explanation', 'autosave', 'adaptive', 'stats_basic'],
        'pro': ['highlight', 'fullscreen', 'explanation', 'autosave', 'roadmap', 'adaptive', 'crossout', 'error_correction', 'stats_basic', 'stats_pro'],
        'ultra': ['highlight', 'fullscreen', 'explanation', 'autosave', 'roadmap', 'adaptive', 'crossout', 'error_correction', 'infinite_mock', 'stats_basic', 'stats_pro', 'stats_ultra']
    };

    const userFeatures = plans[currentPlan] || plans['basic'];
    
    if (!userFeatures.includes(feature)) {
        if(!silent) {
            showToast("Tính năng này yêu cầu nâng cấp gói cước để sử dụng.", true);
            switchScreen('pricing');
        }
        return false;
    }
    return true;
}

function saveProgressLocally() {
    if(!checkFeatureAccess('autosave', true)) return;
    if(!activeQuiz) return;
    const progress = {
        quizId: activeQuiz.id,
        userAnswers: userAnswers,
        timeLeft: timeLeft,
        flaggedQuestions: flaggedQuestions,
        shuffledQuestions: activeQuiz.questions 
    };
    localStorage.setItem('quizProgress_' + activeQuiz.id, JSON.stringify(progress));
}

// [VIP TỐI THƯỢNG] THUẬT TOÁN BỘ NHỚ ĐỆM ĐA TẦNG - HIỂN THỊ TRONG 0MS CHO CẢ GV VÀ HS
function fetchQuizzesFromFirebase() {
    if (!auth.currentUser) return;
    
    // Ngắt tuyệt đối các luồng cũ để giải phóng bộ nhớ, chống nghẽn mạch
    if (teacherQuizListener) { teacherQuizListener(); teacherQuizListener = null; }
    if (window.studentQuizListeners && window.studentQuizListeners.length > 0) {
        window.studentQuizListeners.forEach(unsub => unsub());
        window.studentQuizListeners = [];
    }

    // [VIP] CẤY LÕI TRÍ NHỚ TẠM: Nạp dữ liệu từ RAM máy ngay lập tức khi vừa mở Web
    const cachedQuizzes = localStorage.getItem('cachedQuizzes_' + auth.currentUser.uid);
    if (cachedQuizzes) {
        quizDatabase = JSON.parse(cachedQuizzes);
    } else {
        quizDatabase = [];
    }

    // Vẽ card môn học ngay lập tức trong 0 mili-giây, bất chấp mạng lag
    if (screens.home && !screens.home.classList.contains('hidden')) {
        renderHomeQuizList();
    }

    if (currentRole === 'teacher') {
        teacherQuizListener = db.collection("quizzes")
          .where("authorId", "==", auth.currentUser.uid)
          .onSnapshot((snapshot) => {
            if (isSharedMode) return; 
            let tempQuizzes = [];
            snapshot.forEach((doc) => { tempQuizzes.push(doc.data()); });
            
            quizDatabase = tempQuizzes;
            isQuizzesLoaded = true; 
            
            // Khắc ghi dữ liệu gốc vào bộ nhớ máy để lần sau load tức thời
            localStorage.setItem('cachedQuizzes_' + auth.currentUser.uid, JSON.stringify(quizDatabase));
            
            if (screens.home && !screens.home.classList.contains('hidden')) {
                renderHomeQuizList(); 
            }
            if (screens.subjectDetail && !screens.subjectDetail.classList.contains('hidden')) {
                renderSubjectDetailView(currentSelectedCategory);
            }
        }, (error) => { 
            console.error("Lỗi tải dữ liệu Giáo viên: ", error); 
            isQuizzesLoaded = true; 
            renderHomeQuizList();
        });
    } else {
        fetchStudentPinnedQuizzes(); 
    }
}

// [VIP TỐI THƯỢNG] TUYẾN ĐƯỜNG ĐẠI BÁC GOM ĐỀ CHẠY NGẦM CHO HỌC SINH
function fetchStudentPinnedQuizzes() {
    if (currentRole !== 'student' || isSharedMode) return;
    
    if (!pinnedFolders || pinnedFolders.length === 0) {
        quizDatabase = [];
        isQuizzesLoaded = true;
        if (screens.home && !screens.home.classList.contains('hidden')) renderHomeQuizList();
        return;
    }
    
    if (window.studentQuizListeners && window.studentQuizListeners.length > 0) {
        window.studentQuizListeners.forEach(unsub => unsub());
    }
    window.studentQuizListeners = [];
    
    const teacherIds = [...new Set(pinnedFolders.map(f => typeof f === 'object' ? f.teacherId : auth.currentUser.uid))].filter(Boolean);
    
    if (teacherIds.length === 0) {
        isQuizzesLoaded = true;
        return;
    }

    let loadedChunks = 0;
    const totalChunks = Math.ceil(teacherIds.length / 10);

    for (let i = 0; i < teacherIds.length; i += 10) {
        const chunk = teacherIds.slice(i, i + 10);
        let unsub = db.collection("quizzes")
            .where("authorId", "in", chunk)
            .onSnapshot((snapshot) => {
                let incomingData = [];
                snapshot.forEach(doc => { incomingData.push(doc.data()); });
                
                quizDatabase = quizDatabase.filter(q => !chunk.includes(q.authorId));
                
                let relevantIncoming = incomingData.filter(quiz => 
                    pinnedFolders.some(f => {
                        if (typeof f === 'object') return f.teacherId === quiz.authorId && f.category === quiz.category;
                        return quiz.category === f; 
                    })
                );
                
                quizDatabase = [...quizDatabase, ...relevantIncoming];
                isQuizzesLoaded = true; 
                
                // Cập nhật bộ nhớ đệm học sinh
                localStorage.setItem('cachedQuizzes_' + auth.currentUser.uid, JSON.stringify(quizDatabase));
                
                if (screens.home && !screens.home.classList.contains('hidden') && currentStudentTab === 'browse') {
                    renderHomeQuizList();
                }
            }, (error) => {
                console.error("Lỗi đường truyền học sinh:", error);
                isQuizzesLoaded = true;
                if (screens.home && !screens.home.classList.contains('hidden')) renderHomeQuizList();
            });
        
        window.studentQuizListeners.push(unsub);
    }

    // Bảo hiểm chống treo mạch mạng
    setTimeout(() => {
        if (!isQuizzesLoaded) {
            isQuizzesLoaded = true;
            if (screens.home && !screens.home.classList.contains('hidden')) renderHomeQuizList();
        }
    }, 4000);
}

function fetchHistoryFromFirebase() {
    if (!auth.currentUser) return;
    db.collection("results")
      .where("uid", "==", auth.currentUser.uid)
      .onSnapshot((snapshot) => {
          historyDatabase = [];
          snapshot.forEach(doc => { historyDatabase.push({ id: doc.id, data: doc.data() }); });
          
          historyDatabase.sort((a, b) => {
              let sA = a.data.timestamp ? a.data.timestamp.seconds : 0;
              let sB = b.data.timestamp ? b.data.timestamp.seconds : 0;
              return sB - sA;
          });
          
          isHistoryLoaded = true; 
          if (currentRole === 'student' && currentStudentTab === 'history' && screens.home && !screens.home.classList.contains('hidden')) {
              renderHomeQuizList(); 
          }
      }, (error) => { console.error("Lỗi tải lịch sử: ", error); });
}

function checkUrlForSharedQuiz(quizId) {
    isSharedMode = true; 
    
    // Hiển thị trạng thái đang tải cực đẹp để tránh màn hình đen
    const appDiv = document.getElementById('app');
    if(appDiv) appDiv.insertAdjacentHTML('afterbegin', '<div id="global-loader" class="fixed inset-0 bg-[#0F172A] z-[9999] flex flex-col items-center justify-center"><i class="fas fa-circle-notch fa-spin text-4xl text-blue-500 mb-4"></i><p class="text-white font-bold tracking-widest animate-pulse">ĐANG TẢI DỮ LIỆU...</p></div>');

    db.collection("quizzes").doc(quizId).get().then((doc) => {
        const loader = document.getElementById('global-loader'); if(loader) loader.remove();
        
        if (doc.exists) {
            activeQuiz = doc.data(); prepareWelcomeScreen();
        } else {
            showToast("Đề thi này không tồn tại hoặc đã bị gỡ bỏ khỏi hệ thống.", true); switchScreen('home');
        }
        window.history.replaceState({}, document.title, window.location.pathname);
    }).catch(err => { 
        const loader = document.getElementById('global-loader'); if(loader) loader.remove();
        console.error("Lỗi đường dẫn: ", err); switchScreen('home'); 
    });
}

function loadSharedFolder(category, teacherId) {
    showToast("Đang tải dữ liệu môn học...", false);
    isSharedMode = true; 
    
    // [VÁ LỖI]: Bốc dữ liệu từ RAM ngay lập tức nếu đã có, không đợi đám mây!
    let cachedFolder = quizDatabase.filter(q => q.category === category && q.authorId === teacherId);
    if (cachedFolder.length > 0) {
        currentSelectedCategory = category;
        switchScreen('subjectDetail'); 
        showToast(`Đã tải thành công thư mục: ${category}`, false);
        window.history.replaceState({}, document.title, window.location.pathname);
        return;
    }
    
    // [VÁ LỖI]: Tối ưu truy vấn Firebase, chỉ tải đúng môn học cần thiết thay vì tải toàn bộ
    db.collection("quizzes")
      .where("authorId", "==", teacherId)
      .where("category", "==", category) 
      .get().then(snapshot => {
          snapshot.forEach(doc => { 
              // Tránh trùng lặp nếu đã có trong mảng
              if (!quizDatabase.some(q => q.id === doc.id)) {
                  quizDatabase.push(doc.data()); 
              }
          });
          
          if(snapshot.empty && cachedFolder.length === 0) {
              showToast("Thư mục này hiện tại không có dữ liệu.", true);
              switchScreen('home');
              return;
          }
          
          isQuizzesLoaded = true; 

          if (auth.currentUser && currentRole === 'student') {
              const exists = pinnedFolders.some(f => f.category === category && f.teacherId === teacherId);
              if (!exists) {
                  db.collection("users").doc(auth.currentUser.uid).update({
                      pinnedFolders: firebase.firestore.FieldValue.arrayUnion({ category, teacherId })
                  });
                  showToast("Đã ghim thư mục này vào Kho Môn Học của bạn!", false);
              }
          }
          
          currentSelectedCategory = category;
          switchScreen('subjectDetail'); 
          showToast(`Đã tải thành công thư mục: ${category}`, false);
          window.history.replaceState({}, document.title, window.location.pathname);
      }).catch(err => {
          showToast("Lỗi khi tải thư mục: " + err.message, true);
          switchScreen('home');
      });
}

window.copyLink = function(link) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(link).then(() => { 
            showToast("Đã sao chép liên kết thành công.", false); 
        }).catch(() => fallbackCopy(link));
    } else {
        fallbackCopy(link);
    }
};

function fallbackCopy(text) {
    let textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed"; 
    textArea.style.top = "-9999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        document.execCommand('copy');
        showToast("Đã sao chép liên kết thành công.", false);
    } catch (err) {
        showToast("Lỗi: Trình duyệt của bạn không hỗ trợ sao chép tự động.", true);
    }
    document.body.removeChild(textArea);
}

function showToast(message, isError = true) {
    const toast = document.getElementById('system-toast');
    const msg = document.getElementById('system-toast-msg');
    if(!toast || !msg) { console.log(message); return; }
    
    toast.style.cssText = ""; 
    msg.innerText = message;
    toast.className = `fixed top-6 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-xl shadow-2xl font-bold z-[9999] transition-all duration-300 flex items-center gap-3 opacity-100 ${isError ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`;
    
    setTimeout(() => {
        if(toast.classList.contains('opacity-100')) {
            toast.classList.replace('top-6', 'top-[-100px]');
            toast.classList.replace('opacity-100', 'opacity-0');
        }
    }, 4000);
}

function setupEventListeners() {
    const addEvt = (id, event, handler) => { const el = document.getElementById(id); if (el) el.addEventListener(event, handler); };

    addEvt('btn-auth-toggle', 'click', () => toggleAuthMode(!isLoginMode));
    addEvt('btn-auth-submit', 'click', handleAuthSubmit);
    addEvt('btn-logout', 'click', () => { if(confirm("Xác nhận đăng xuất?")) auth.signOut(); });
    
    addEvt('role-student', 'click', () => { 
        isSharedMode = false; 
        isQuizzesLoaded = false;
        setRole('student'); 
        fetchQuizzesFromFirebase(); 
    });
    addEvt('role-teacher', 'click', () => { 
        isSharedMode = false; 
        isQuizzesLoaded = false;
        setRole('teacher'); 
        fetchQuizzesFromFirebase();
    });
    
    addEvt('btn-theme-toggle', 'click', toggleDarkMode);
    addEvt('btn-show-admin', 'click', () => { editingQuizId = null; switchScreen('admin'); });
    
    const goHome = () => { 
        isSharedMode = false; 
        isQuizzesLoaded = false;
        fetchQuizzesFromFirebase(); 
        window.history.pushState({}, '', window.location.pathname); 
        switchScreen('home'); 
    };
    addEvt('btn-back-to-home', 'click', goHome);
    addEvt('btn-back-to-subject', 'click', () => switchScreen('subjectDetail'));
    addEvt('btn-home', 'click', goHome);
    
    addEvt('btn-exit-quiz', 'click', () => {
        if (isReviewMode) {
            switchScreen('result');
            const resultScoreEl = document.getElementById('result-score');
            if (resultScoreEl && resultScoreEl.innerText === '0/0') { 
                switchScreen('subjectDetail'); 
            }
        } else if (confirm("Thoát? Tiến trình làm bài sẽ được tự động lưu (áp dụng cho tài khoản nâng cấp).")) {
            clearInterval(timerInterval); 
            exitFullscreen(); 
            saveProgressLocally(); 
            switchScreen('subjectDetail');
        }
    });

    addEvt('btn-start-mock-generate', 'click', generateSubjectMockTest);
    addEvt('btn-practice', 'click', () => startQuiz(true));
    addEvt('btn-mock', 'click', () => startQuiz(false));
    addEvt('btn-prev', 'click', () => { const idx = getFilteredIndex(-1); if (idx !== -1) loadQuestion(idx); });
    addEvt('btn-next', 'click', () => { const idx = getFilteredIndex(1); if (idx !== -1) loadQuestion(idx); });
    
    addEvt('btn-submit', 'click', () => {
        if (isReviewMode) switchScreen('result'); 
        else submitQuiz(false); 
    });
    
    addEvt('btn-review', 'click', reviewQuiz);
    addEvt('btn-hint', 'click', () => {
        const hintBox = document.getElementById('hint-box');
        if(hintBox) hintBox.classList.remove('hidden');
    });
    addEvt('btn-flag', 'click', toggleFlag);
    
    addEvt('btn-show-roadmap', 'click', () => {
        const rc = document.getElementById('roadmap-container');
        if(rc) { 
            rc.classList.toggle('hidden'); 
            if(!rc.classList.contains('hidden')) rc.scrollIntoView({behavior: 'smooth'}); 
        }
    });
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
}

function toggleAuthMode(loginMode) {
    isLoginMode = loginMode;
    const title = document.getElementById('auth-title'); const btnSubmit = document.getElementById('btn-auth-submit');
    const toggleMsg = document.getElementById('auth-toggle-msg'); const toggleBtn = document.getElementById('btn-auth-toggle');
    const nameField = document.getElementById('div-auth-name');
    if(!title || !btnSubmit) return;
    document.getElementById('auth-email').value = ''; document.getElementById('auth-password').value = '';
    const nameInput = document.getElementById('auth-name'); if(nameInput) nameInput.value = '';

    if (isLoginMode) {
        title.innerText = "Đăng Nhập Hệ Thống"; btnSubmit.innerText = "Đăng Nhập";
        toggleMsg.innerText = "Chưa có tài khoản?"; toggleBtn.innerText = "Đăng ký ngay";
        if(nameField) nameField.classList.add('hidden');
    } else {
        title.innerText = "Đăng Ký Tài Khoản"; btnSubmit.innerText = "Tạo Tài Khoản";
        toggleMsg.innerText = "Đã có tài khoản?"; toggleBtn.innerText = "Đăng nhập ngay";
        if(nameField) nameField.classList.remove('hidden');
    }
}

function handleAuthSubmit() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value.trim();
    const nameInput = document.getElementById('auth-name');
    const name = nameInput ? nameInput.value.trim() : "";
    if (!email || !password) return alert("Vui lòng nhập đầy đủ thông tin.");
    if (isLoginMode) { auth.signInWithEmailAndPassword(email, password).catch(err => showToast("Đăng nhập thất bại, vui lòng kiểm tra lại.", true)); } 
    else {
        if (!name) return alert("Vui lòng nhập Họ và tên.");
        auth.createUserWithEmailAndPassword(email, password).then((result) => { return result.user.updateProfile({ displayName: name }); })
        .then(() => { showToast("Đăng ký thành công.", false); auth.currentUser.reload(); }).catch(err => showToast("Lỗi đăng ký: " + err.message, true));
    }
}

function setRole(role) {
    currentRole = role;
    const btnStudent = document.getElementById('role-student'); const btnTeacher = document.getElementById('role-teacher');
    const btnAdmin = document.getElementById('btn-show-admin'); const studentTabs = document.getElementById('student-tabs');

    if(btnStudent) btnStudent.className = 'flex-1 lg:flex-none px-4 sm:px-8 py-2.5 rounded-lg font-bold transition-all text-gray-500 hover:text-gray-700 dark:text-gray-400';
    if(btnTeacher) btnTeacher.className = 'flex-1 lg:flex-none px-4 sm:px-8 py-2.5 rounded-lg font-bold transition-all text-gray-500 hover:text-gray-700 dark:text-gray-400';

    if (role === 'student') {
        if(btnStudent) btnStudent.classList.add('bg-white', 'shadow-md', 'text-blue-900', 'dark:bg-gray-800', 'dark:text-white');
        if(btnAdmin) btnAdmin.classList.add('hidden');
        if (studentTabs) studentTabs.classList.replace('hidden', 'flex');
        switchStudentTab('browse'); 
    } else {
        if(btnTeacher) btnTeacher.classList.add('bg-white', 'shadow-md', 'text-blue-900', 'dark:bg-gray-800', 'dark:text-white');
        if(btnAdmin) btnAdmin.classList.remove('hidden');
        if (studentTabs) studentTabs.classList.replace('flex', 'hidden');
    }
    if (screens.home && !screens.home.classList.contains('hidden')) renderHomeQuizList(); 
    if (screens.subjectDetail && !screens.subjectDetail.classList.contains('hidden')) renderSubjectDetailView(currentSelectedCategory);
}

function switchStudentTab(tab) {
    currentStudentTab = tab;
    const btnBrowse = document.getElementById('btn-tab-browse');
    const btnHistory = document.getElementById('btn-tab-history');
    const btnCommunity = document.getElementById('btn-tab-community');
    
    const inactiveClass = "px-5 py-2 font-bold rounded-full text-xs sm:text-sm transition-all text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5";
    const activeClass = "px-5 py-2 font-bold rounded-full text-xs sm:text-sm transition-all bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-md flex items-center gap-1.5";
    
    if(btnBrowse) btnBrowse.className = inactiveClass;
    if(btnHistory) btnHistory.className = inactiveClass;
    if(btnCommunity) btnCommunity.className = "px-5 py-2 font-bold rounded-full text-xs sm:text-sm flex items-center gap-1.5 transition-all bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700";

    if (tab === 'browse' && btnBrowse) {
        btnBrowse.className = activeClass;
    } else if (tab === 'history' && btnHistory) {
        btnHistory.className = activeClass;
    } else if (tab === 'community' && btnCommunity) {
        btnCommunity.className = "px-5 py-2 font-bold rounded-full text-xs sm:text-sm flex items-center gap-1.5 transition-all bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg transform scale-105";
    }
    
    // Điều hướng luồng Render
    if (tab === 'community') {
        fetchAndRenderCommunity();
    } else {
        renderHomeQuizList();
    }
}

function toggleDarkMode() {
    document.documentElement.classList.toggle('dark');
    const isDark = document.documentElement.classList.contains('dark');
    
    const icon = document.getElementById('theme-icon');
    if(icon) icon.className = isDark ? 'fas fa-sun text-lg sm:text-xl' : 'fas fa-moon text-lg sm:text-xl';
    
    // [VIP] Khắc lệnh vào kim bài bộ nhớ
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

function switchScreen(screenName) {
    if (screenName === 'admin' && !checkIsMasterAdmin() && currentRole !== 'teacher') {
        showToast("Tài khoản không có quyền truy cập khu vực quản trị giáo viên.", true);
        return;
    }

    const toast = document.getElementById('system-toast');
    if (toast) {
        toast.style.cssText = ""; 
        toast.className = 'fixed top-[-100px] left-1/2 transform -translate-x-1/2 bg-red-600 text-white px-6 py-3 rounded-xl shadow-2xl font-bold z-[9999] transition-all duration-300 flex items-center gap-3 opacity-0 pointer-events-none';
    }

    Object.values(screens).forEach(screen => {
        if(screen) { screen.classList.add('hidden'); screen.classList.remove('flex'); }
    });
    if(screens[screenName]) {
        screens[screenName].classList.remove('hidden');
        if (screenName === 'quiz') screens[screenName].classList.add('flex');
    }
    if(screenName === 'home') renderHomeQuizList();
    const fInput = document.getElementById('search-folder-input'); if(fInput) fInput.value = "";
    if(screenName === 'subjectDetail') renderSubjectDetailView(currentSelectedCategory);
    if(screenName === 'admin') {
        switchAdminTab('smart');
        const mc = document.getElementById('manual-questions-container'); if(mc) mc.innerHTML = '';
        const mt = document.getElementById('manual-test-only'); if(mt) mt.checked = false;
        
        const tabUsers = document.getElementById('tab-users');
        if (tabUsers) {
            if (typeof checkIsMasterAdmin === 'function' && checkIsMasterAdmin()) {
                tabUsers.classList.remove('hidden');
                tabUsers.classList.add('flex-1', 'md:flex-none');
            } else {
                tabUsers.classList.add('hidden');
                tabUsers.classList.remove('flex-1', 'md:flex-none');
            }
        }
    }
}

// [VIP SAAS] HIỂN THỊ KHO MÔN HỌC & LỊCH SỬ PHONG CÁCH LINEAR / NOTION
function renderHomeQuizList() {
    const container = document.getElementById('quiz-list-container');
    if(!container) return;
    container.innerHTML = '';
    
    const searchEl = document.getElementById('search-folder-input');
    const keyword = searchEl ? searchEl.value.trim().toLowerCase() : "";
    
    if (currentRole === 'teacher' || currentStudentTab === 'browse') {
        let categoriesToRender = [];

        if (currentRole === 'teacher') {
            categoriesToRender = [...new Set(quizDatabase.map(q => q.category))].map(cat => ({ category: cat }));
        } else {
            if (pinnedFolders.length === 0) {
                container.innerHTML = '<div class="col-span-full flex flex-col items-center justify-center py-16 text-slate-400"><i class="fas fa-folder-open text-4xl mb-3 opacity-20"></i><p class="text-sm font-medium">Kho lưu trữ trống. Vui lòng sử dụng liên kết từ Giáo viên để ghim môn học.</p></div>';
                return;
            }
            categoriesToRender = pinnedFolders; 
        }
        
        if (keyword) {
            categoriesToRender = categoriesToRender.filter(f => {
                let catName = typeof f === 'object' ? f.category : f;
                return catName.toLowerCase().includes(keyword);
            });
        }

        if (categoriesToRender.length === 0) {
            container.innerHTML = '<p class="col-span-full text-center text-slate-400 font-medium py-12">Không tìm thấy môn học nào khớp với từ khóa.</p>'; return;
        }

        const cachedCounts = JSON.parse(localStorage.getItem('cachedQuizCounts') || '{}');

        categoriesToRender.forEach(folderObj => {
            const category = typeof folderObj === 'object' ? folderObj.category : folderObj;
            const tId = typeof folderObj === 'object' ? folderObj.teacherId : null;
            
            let totalQuizzes = 0;
            if (isQuizzesLoaded || currentRole === 'teacher') {
                totalQuizzes = currentRole === 'teacher' 
                    ? quizDatabase.filter(q => q.category === category).length
                    : quizDatabase.filter(q => q.category === category && q.authorId === tId).length;
                cachedCounts[category] = totalQuizzes;
                localStorage.setItem('cachedQuizCounts', JSON.stringify(cachedCounts));
            } else {
                totalQuizzes = cachedCounts[category] || 0;
            }

            let quizCountText = `<span class="font-semibold text-slate-500 dark:text-slate-400">${totalQuizzes}</span> đề thi`;
            if (!isQuizzesLoaded && currentRole === 'student') {
                quizCountText += ` <span class="inline-block w-1.5 h-1.5 ml-2 bg-blue-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.6)]" title="Đang đồng bộ ngầm..."></span>`;
            }

            const card = document.createElement('div');
            // Premium Card: Không màu mè, Border mỏng, Shadow cực êm, Lift nhẹ
            card.className = 'relative p-5 bg-white dark:bg-[#1E293B] border border-slate-200/60 dark:border-slate-700/60 rounded-[20px] hover:-translate-y-1 hover:shadow-[0_12px_30px_rgba(0,0,0,0.04)] hover:border-slate-300 dark:hover:border-slate-600 transition-all duration-300 cursor-pointer group flex flex-col justify-between min-h-[110px]';
            
            let shareBtnHTML = '';
            if (checkIsMasterAdmin() || currentRole === 'teacher') {
                const folderLink = `${window.location.origin}${window.location.pathname}?folder=${encodeURIComponent(category)}&t=${auth.currentUser.uid}`;
                shareBtnHTML = `<button onclick="event.stopPropagation(); copyLink('${folderLink}')" class="absolute top-4 right-4 text-slate-300 hover:text-blue-600 bg-transparent hover:bg-slate-50 dark:hover:bg-slate-800 rounded-full w-8 h-8 flex items-center justify-center transition-colors z-20" title="Chia sẻ toàn bộ môn này"><i class="fas fa-link text-xs"></i></button>`;
            } else if (currentRole === 'student') {
                shareBtnHTML = `<button onclick="event.stopPropagation(); unpinFolder('${category}', '${tId}')" class="absolute top-4 right-4 text-slate-300 hover:text-red-500 bg-transparent hover:bg-red-50 dark:hover:bg-red-950/30 rounded-full w-8 h-8 flex items-center justify-center transition-colors z-20" title="Bỏ ghim thư mục"><i class="fas fa-bookmark text-xs"></i></button>`;
            }

            card.innerHTML = `
                ${shareBtnHTML}
                <div class="flex items-start w-full min-w-0 pr-8">
                    <div class="w-10 h-10 sm:w-12 sm:h-12 bg-slate-50 dark:bg-slate-800 text-blue-600 dark:text-blue-400 rounded-[12px] flex items-center justify-center text-lg sm:text-xl border border-slate-100 dark:border-slate-700/50 group-hover:scale-105 transition-transform duration-300 shrink-0 mr-3.5 shadow-sm">
                        <i class="fas fa-folder"></i>
                    </div>
                    <div class="flex-1 min-w-0 pt-0.5">
                        <h3 class="text-base sm:text-lg font-bold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors leading-tight tracking-tight" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;" title="${category}">${category}</h3>
                        <p class="text-[11px] sm:text-xs text-slate-400 mt-2 flex items-center tracking-wide uppercase">${quizCountText}</p>
                    </div>
                </div>
            `;
            card.onclick = () => { currentSelectedCategory = category; switchScreen('subjectDetail'); };
            container.appendChild(card);
        });
    } 
    else if (currentRole === 'student' && currentStudentTab === 'history') {
        if (!auth.currentUser) return;
        
        if (!isHistoryLoaded) {
            container.innerHTML = '<div class="col-span-full flex flex-col items-center py-12"><i class="fas fa-circle-notch fa-spin text-slate-300 text-3xl mb-3"></i><p class="text-sm font-medium text-slate-400">Đang đồng bộ dữ liệu lịch sử...</p></div>'; return;
        }

        let filteredHistory = historyDatabase;
        if (keyword) {
            filteredHistory = historyDatabase.filter(item => 
                (item.data.quizTitle && item.data.quizTitle.toLowerCase().includes(keyword)) ||
                (item.data.category && item.data.category.toLowerCase().includes(keyword))
            );
        }

        if (filteredHistory.length === 0) {
            container.innerHTML = '<p class="col-span-full text-center text-slate-400 font-medium py-12">Chưa có dữ liệu lịch sử làm bài.</p>'; return;
        }

        filteredHistory.forEach(item => {
            const res = item.data;
            const formatStr = res.timestamp ? new Date(res.timestamp.seconds * 1000).toLocaleString('vi-VN') : "Vừa xong";
            
            const card = document.createElement('div');
            // Cân bằng chiều cao bằng h-full, layout dọc linh hoạt
            card.className = 'p-5 sm:p-6 bg-white dark:bg-[#1E293B] border border-slate-200/60 dark:border-slate-700/60 rounded-[24px] shadow-[0_4px_20px_-4px_rgba(0,0,0,0.02)] flex flex-col h-full relative hover:shadow-[0_12px_30px_-6px_rgba(0,0,0,0.06)] hover:-translate-y-1 hover:border-slate-300 dark:hover:border-slate-500 transition-all duration-300 group';
            
            let isMock = res.quizId && (String(res.quizId).startsWith("MOCK-") || String(res.quizId).startsWith("ERROR-CORRECTION-"));
            
            // Các nút bấm chuyển sang w-full để lấp đầy ô Grid
            let actionBtnHTML = isMock ? '' : `<button onclick="redoQuizFromHistory('${res.quizId}')" class="w-full py-2.5 bg-slate-900 dark:bg-slate-700 text-white text-[11px] sm:text-xs font-bold rounded-xl hover:bg-slate-800 shadow-md shadow-slate-900/10 transition-all flex items-center justify-center gap-1.5"><i class="fas fa-redo text-[10px]"></i>Làm lại đề này</button>`;
            
            let reviewBtnHTML = `<button onclick="reviewPastQuiz('${res.quizId}', '${item.id}')" class="w-full py-2.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] sm:text-xs font-bold rounded-xl hover:bg-slate-50 border border-slate-200 dark:border-slate-700 transition-all flex items-center justify-center gap-1.5"><i class="fas fa-eye text-[10px]"></i>Chi tiết</button>`;
            
            let errorBtnHTML = `<button onclick="generateErrorCorrection('${item.id}')" class="w-full py-2.5 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 text-[11px] sm:text-xs font-bold rounded-xl hover:bg-amber-100 border border-amber-200/60 dark:border-amber-800/50 transition-all flex items-center justify-center gap-1.5"><i class="fas fa-tools text-[10px]"></i>Vá lỗi sai</button>`;

            card.innerHTML = `
                <!-- Nút Xóa lịch sử làm mượt mà, căn góc chuẩn -->
                <button onclick="deleteHistoryEntry('${item.id}')" class="absolute top-4 right-4 text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-full w-8 h-8 flex items-center justify-center transition-all opacity-0 group-hover:opacity-100" title="Xóa lịch sử"><i class="fas fa-times"></i></button>
                
                <div class="flex flex-col flex-grow">
                    <div class="pr-8 mb-4">
                        <span class="text-[9px] px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-lg font-extrabold uppercase tracking-widest border border-slate-200/60 dark:border-slate-700 inline-block mb-3">${res.category}</span>
                        <h3 class="text-base sm:text-lg font-extrabold tracking-tight text-slate-900 dark:text-white line-clamp-2 leading-snug mb-1.5">${res.quizTitle}</h3>
                        <p class="text-[10px] sm:text-xs text-slate-400 font-medium flex items-center"><i class="far fa-clock mr-1.5"></i>Nộp lúc: ${formatStr}</p>
                    </div>
                    
                    <!-- Bảng điểm đối xứng tuyệt đối (Gương soi 2 nửa) -->
                    <div class="grid grid-cols-2 gap-4 mt-auto p-4 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-slate-100 dark:border-slate-800/60">
                        <div class="flex flex-col justify-center border-r border-slate-200 dark:border-slate-700/50 pr-4">
                            <span class="text-slate-400 uppercase tracking-wider text-[9px] font-bold mb-1">Điểm / Tỷ lệ</span> 
                            <div class="flex items-baseline gap-1.5">
                                <strong class="text-slate-900 dark:text-white font-mono text-base">${res.score}</strong> 
                                <span class="${res.percentage >= 50 ? 'text-green-500' : 'text-red-500'} font-bold font-mono text-xs bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded shadow-sm border border-slate-100 dark:border-slate-700">${res.percentage}%</span>
                            </div>
                        </div>
                        <div class="flex flex-col justify-center pl-1">
                            <span class="text-slate-400 uppercase tracking-wider text-[9px] font-bold mb-1">Thời gian thi</span> 
                            <strong class="text-slate-700 dark:text-slate-300 font-mono text-base">${res.timeUsed}</strong>
                        </div>
                    </div>
                </div>
                
                <!-- Khu vực nút bấm cấu trúc Grid hoàn hảo, không còn hiện tượng thò thụt -->
                <div class="mt-5 pt-5 border-t border-slate-100 dark:border-slate-700/80">
                    <div class="grid grid-cols-2 gap-3 mb-3">
                        ${errorBtnHTML}
                        ${reviewBtnHTML}
                    </div>
                    ${actionBtnHTML}
                </div>
            `;
            container.appendChild(card);
        });
    }
}

// [VIP SAAS] HIỂN THỊ CHI TIẾT MÔN HỌC & ĐỀ THI
function renderSubjectDetailView(category) {
    const titleEl = document.getElementById('subject-detail-title'); if(titleEl) titleEl.innerText = category;
    checkFolderPublishStatus(category); // Lệnh gọi bộ định vị trạng thái Cộng Đồng
    const container = document.getElementById('chapter-list-container'); if(!container) return;
    
    // Xóa rỗng container
    container.innerHTML = '';

    const searchEl = document.getElementById('search-chapter-input');
    const keyword = searchEl ? searchEl.value.trim().toLowerCase() : "";

    let quizzesInFolder = quizDatabase.filter(q => q.category === category);
    if (keyword) quizzesInFolder = quizzesInFolder.filter(quiz => quiz.title.toLowerCase().includes(keyword));

    if(quizzesInFolder.length === 0) {
        container.innerHTML = '<p class="col-span-full text-center text-slate-400 font-medium py-10">Không tìm thấy tài nguyên nào.</p>'; return;
    }

    // [VÁ LỖI]: Dùng DocumentFragment để gom tất cả thẻ HTML lại rồi mới ném ra màn hình 1 lần duy nhất (Nhanh x10 lần)
    const fragment = document.createDocumentFragment();

    quizzesInFolder.forEach(quiz => {
        const card = document.createElement('div');
        card.className = 'relative p-5 sm:p-6 bg-white dark:bg-[#1E293B] border border-slate-200/60 dark:border-slate-700/60 rounded-[20px] shadow-sm hover:shadow-[0_8px_20px_rgba(0,0,0,0.04)] hover:-translate-y-0.5 hover:border-slate-300 dark:hover:border-slate-600 transition-all group flex flex-col';
        
        let actionBtnsHTML = '';
        let badgeHTML = quiz.isTestOnly ? 
            '<span class="px-2 py-0.5 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 text-[9px] font-bold uppercase tracking-wider rounded-md border border-red-200/50 dark:border-red-900/50">Kiểm tra</span>' : 
            '<span class="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[9px] font-bold uppercase tracking-wider rounded-md border border-slate-200/50 dark:border-slate-700">Luyện tập</span>';

        if (checkIsMasterAdmin() || currentRole === 'teacher') {
            const shareLink = `${window.location.origin}${window.location.pathname}?quiz=${quiz.id}`;
            actionBtnsHTML = `
                <div class="absolute top-4 right-4 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onclick="event.stopPropagation(); copyLink('${shareLink}')" class="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg w-7 h-7 flex items-center justify-center transition-colors border border-slate-200 dark:border-slate-700" title="Sao chép link"><i class="fas fa-link text-[10px]"></i></button>
                    <button onclick="event.stopPropagation(); editQuiz('${quiz.id}')" class="text-slate-400 hover:text-amber-500 bg-slate-50 hover:bg-amber-50 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg w-7 h-7 flex items-center justify-center transition-colors border border-slate-200 dark:border-slate-700" title="Sửa"><i class="fas fa-edit text-[10px]"></i></button>
                    <button onclick="event.stopPropagation(); deleteQuiz('${quiz.id}')" class="text-slate-400 hover:text-red-500 bg-slate-50 hover:bg-red-50 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg w-7 h-7 flex items-center justify-center transition-colors border border-slate-200 dark:border-slate-700" title="Xóa"><i class="fas fa-trash-alt text-[10px]"></i></button>
                </div>
            `;
        }

        card.innerHTML = `
            ${actionBtnsHTML}
            <div class="mb-3">${badgeHTML}</div>
            <h3 class="text-lg font-extrabold tracking-tight text-slate-900 dark:text-white cursor-pointer group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-2 leading-snug" onclick="selectQuiz('${quiz.id}')">${quiz.title}</h3>
            <div class="mt-auto pt-4 flex items-center gap-4 text-[11px] font-medium text-slate-400 uppercase tracking-wide">
                <span><i class="far fa-clock mr-1 text-slate-300"></i>${Math.floor(quiz.timeLimit / 60)} phút</span>
                <span><i class="fas fa-layer-group mr-1 text-slate-300"></i>${quiz.questions.length} câu</span>
            </div>
        `;
        fragment.appendChild(card);
    });
    
    container.appendChild(fragment);
}
  
function redoQuizFromHistory(quizId) {
    db.collection("quizzes").doc(quizId).get().then((doc) => {
        if (doc.exists) { activeQuiz = doc.data(); prepareWelcomeScreen(); } 
        else { showToast("Đề thi này không tồn tại hoặc đã bị gỡ bỏ.", true); }
    }).catch(err => showToast("Lỗi tải đề thi: " + err.message, true));
}

window.generateErrorCorrection = function(resultDocId) {
    if(!checkFeatureAccess('error_correction')) return; 
    showToast("Đang xử lý dữ liệu câu sai...", false);
    
    db.collection("results").doc(resultDocId).get().then((resDoc) => {
        if (resDoc.exists) {
            const pastData = resDoc.data();
            if (!pastData.quizQuestionsSnapshot) return showToast("Dữ liệu không hỗ trợ tính năng này.", true);
            
            let wrongQuestions = [];
            pastData.userAnswers.forEach((ans, idx) => {
                if (ans === null || ans !== pastData.quizQuestionsSnapshot[idx].correctAnswer) {
                    wrongQuestions.push(pastData.quizQuestionsSnapshot[idx]);
                }
            });

            if (wrongQuestions.length === 0) return showToast("Không có câu trả lời sai trong bài thi này.", false);

            activeQuiz = {
                id: "ERROR-CORRECTION-" + Date.now(),
                title: `[Ôn Tập] - ${pastData.quizTitle}`,
                category: pastData.category,
                timeLimit: wrongQuestions.length * 60, 
                questions: wrongQuestions,
                isTestOnly: false,
                authorId: auth.currentUser ? auth.currentUser.uid : "GUEST"
            };
            prepareWelcomeScreen();
        }
    }).catch(err => showToast("Lỗi xử lý dữ liệu: " + err.message, true));
}

function reviewPastQuiz(quizId, resultDocId) {
    db.collection("quizzes").doc(quizId).get().then((quizDoc) => {
        if (!quizDoc.exists) return showToast("Đề thi gốc không còn tồn tại trên hệ thống.", true);
        activeQuiz = quizDoc.data();
        
        db.collection("results").doc(resultDocId).get().then((resDoc) => {
            if (resDoc.exists) {
                const pastData = resDoc.data();
                if (pastData.quizQuestionsSnapshot) activeQuiz.questions = pastData.quizQuestionsSnapshot;

                userAnswers = pastData.userAnswers || new Array(activeQuiz.questions.length).fill(null);
                flaggedQuestions = new Array(activeQuiz.questions.length).fill(false);
                
                isReviewMode = true; isPracticeMode = false;
                
                const dName = document.getElementById('display-student-name'); if(dName) dName.innerText = pastData.studentName + " (Xem lại)";
                const qTitle = document.getElementById('quiz-header-title'); if(qTitle) qTitle.innerText = activeQuiz.title;
                
                const sc = document.getElementById('result-score'); if(sc) sc.innerText = pastData.score;
                const pc = document.getElementById('result-percent'); if(pc) pc.innerText = `${pastData.percentage}%`;
                const tc = document.getElementById('result-time'); if(tc) tc.innerText = pastData.timeUsed;
                

                switchScreen('result');
            }
        });
    }).catch(err => showToast("Lỗi tải thông tin: " + err.message, true));
}

function deleteHistoryEntry(docId) {
    if (confirm("Xác nhận xóa kết quả này khỏi lịch sử?")) {
        db.collection("results").doc(docId).delete().catch(err => showToast("Lỗi khi xóa: " + err.message, true));
    }
}

function renderSubjectDetailView(category) {
    const titleEl = document.getElementById('subject-detail-title'); if(titleEl) titleEl.innerText = "Môn học: " + category;
    const container = document.getElementById('chapter-list-container'); if(!container) return;
    container.innerHTML = '';

    const searchEl = document.getElementById('search-chapter-input');
    const keyword = searchEl ? searchEl.value.trim().toLowerCase() : "";

    let quizzesInFolder = quizDatabase.filter(q => q.category === category);
    
    if (keyword) {
        quizzesInFolder = quizzesInFolder.filter(quiz => quiz.title.toLowerCase().includes(keyword));
    }

    if(quizzesInFolder.length === 0) {
        container.innerHTML = '<p class="col-span-full text-center text-gray-500 py-4">Không tìm thấy đề thi nào khớp với từ khóa.</p>'; return;
    }

    quizzesInFolder.forEach(quiz => {
        const card = document.createElement('div');
        card.className = 'relative p-6 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-2xl shadow-sm hover:shadow-lg transition-all group';
        
        let actionBtnsHTML = '';
        let badgeHTML = quiz.isTestOnly ? 
            '<span class="px-3 py-1 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs font-bold rounded-full border dark:border-red-800">Kiểm tra</span>' : 
            '<span class="px-3 py-1 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-xs font-bold rounded-full border dark:border-gray-500">Luyện tập</span>';

        if (checkIsMasterAdmin() || currentRole === 'teacher') {
            const shareLink = `${window.location.origin}${window.location.pathname}?quiz=${quiz.id}`;
            actionBtnsHTML = `
                <button onclick="event.stopPropagation(); copyLink('${shareLink}')" class="absolute top-4 right-24 text-gray-400 hover:text-blue-500 transition-colors bg-gray-100 dark:bg-gray-800 rounded-full w-8 h-8 flex items-center justify-center shadow-sm" title="Sao chép liên kết"><i class="fas fa-link"></i></button>
                <button onclick="event.stopPropagation(); editQuiz('${quiz.id}')" class="absolute top-4 right-14 text-gray-400 hover:text-green-500 transition-colors bg-gray-100 dark:bg-gray-800 rounded-full w-8 h-8 flex items-center justify-center shadow-sm" title="Chỉnh sửa đề"><i class="fas fa-edit"></i></button>
                <button onclick="event.stopPropagation(); deleteQuiz('${quiz.id}')" class="absolute top-4 right-4 text-gray-400 hover:text-red-500 transition-colors bg-gray-100 dark:bg-gray-800 rounded-full w-8 h-8 flex items-center justify-center shadow-sm" title="Xóa đề"><i class="fas fa-trash-alt"></i></button>
            `;
        } else if (currentRole === 'student') {
            const catQuiz = quizDatabase.find(q => q.category === category);
            const tId = catQuiz ? catQuiz.authorId : '';
            actionBtnsHTML = `<button onclick="event.stopPropagation(); unpinFolder('${category}', '${tId}')" class="absolute top-4 right-4 text-blue-500 hover:text-red-500 bg-blue-50 dark:bg-gray-800 rounded-full w-8 h-8 flex items-center justify-center shadow-sm transition-colors z-10" title="Bỏ ghim thư mục"><i class="fas fa-bookmark"></i></button>`;
        }

        card.innerHTML = `
            ${actionBtnsHTML}
            ${badgeHTML}
            <h3 class="mt-4 text-xl font-bold dark:text-white cursor-pointer hover:text-blue-600" onclick="selectQuiz('${quiz.id}')">${quiz.title}</h3>
            <p class="mt-2 text-sm text-gray-500"><i class="far fa-clock"></i> ${Math.floor(quiz.timeLimit / 60)} phút • ${quiz.questions.length} câu hỏi</p>
        `;
        container.appendChild(card);
    });
}

function selectQuiz(quizId) {
    activeQuiz = quizDatabase.find(q => q.id === quizId);
    if (!activeQuiz) return showToast("Đề thi không tồn tại.", true);
    prepareWelcomeScreen();
}

function deleteQuiz(quizId) {
    if (confirm("Xác nhận xóa vĩnh viễn đề thi này khỏi hệ thống?")) {
        db.collection("quizzes").doc(quizId).delete().then(() => { renderSubjectDetailView(currentSelectedCategory); }).catch(err => showToast("Lỗi hệ thống: " + err, true));
    }
}

window.generateCategoryErrorMock = function() {
    if(!checkFeatureAccess('error_correction')) return;
    showToast("Đang tổng hợp dữ liệu câu sai...", false);

    const sel = document.getElementById('mock-question-count');
    const countSelect = sel ? parseInt(sel.value) : 50;

    let uniqueWrong = {}; 
    let hasData = false;

    historyDatabase.forEach(item => {
        const data = item.data;
        if(data.category === currentSelectedCategory && data.quizQuestionsSnapshot && data.userAnswers) {
            hasData = true;
            data.userAnswers.forEach((ans, idx) => {
                if (ans === null || ans !== data.quizQuestionsSnapshot[idx].correctAnswer) {
                    let q = data.quizQuestionsSnapshot[idx];
                    uniqueWrong[q.content] = q; 
                }
            });
        }
    });

    if(!hasData) return showToast("Hệ thống chưa ghi nhận lịch sử làm bài trong môn này.", true);

    let wrongQuestions = Object.values(uniqueWrong);
    if(wrongQuestions.length === 0) return showToast("Bạn không có câu sai nào cần ôn tập trong môn học này.", false);

    for (let i = wrongQuestions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [wrongQuestions[i], wrongQuestions[j]] = [wrongQuestions[j], wrongQuestions[i]];
    }

    activeQuiz = {
        id: "MOCK-PRO-ERR-" + Date.now(),
        title: `[Ôn Tập] Câu Sai - ${currentSelectedCategory}`,
        category: currentSelectedCategory,
        timeLimit: Math.min(wrongQuestions.length, countSelect) * 60, 
        questions: wrongQuestions.slice(0, countSelect),
        isTestOnly: false, authorId: auth.currentUser.uid
    };
    prepareWelcomeScreen();
}

function generateSubjectMockTest() {
    let limit = 0;
    if(currentPlan === 'basic') limit = 3;
    else if(currentPlan === 'plus') limit = 5;
    else if(currentPlan === 'pro') limit = 15;
    else limit = 999999; 

    if(!checkIsMasterAdmin() && mockGeneratedThisMonth >= limit) {
        showToast(`Bạn đã sử dụng hết hạn mức tạo đề thử trong tháng (${mockGeneratedThisMonth}/${limit}).`, true);
        switchScreen('pricing');
        return;
    }

    const sel = document.getElementById('mock-question-count');
    const countSelect = sel ? parseInt(sel.value) : 50;
    const quizzesInFolder = quizDatabase.filter(q => q.category === currentSelectedCategory);
    
    let poolQuestions = [];
    quizzesInFolder.forEach(quiz => {
        if(quiz.questions && Array.isArray(quiz.questions)) poolQuestions = poolQuestions.concat(quiz.questions);
    });

    if (poolQuestions.length === 0) return showToast("Môn học này chưa có đủ câu hỏi để tiến hành trộn đề.", true);

    let currentIndex = poolQuestions.length, randomIndex;
    while (currentIndex != 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        [poolQuestions[currentIndex], poolQuestions[randomIndex]] = [poolQuestions[randomIndex], poolQuestions[currentIndex]];
    }

    const finalCount = Math.min(countSelect, poolQuestions.length);
    const slicedQuestions = poolQuestions.slice(0, finalCount);

    if(finalCount < countSelect) showToast(`Hệ thống chỉ có thể tổng hợp tối đa ${poolQuestions.length} câu.`, false);

    activeQuiz = {
        id: "MOCK-GENERATED-" + Date.now(),
        title: `Thi Thử Tổng Hợp - ${currentSelectedCategory}`,
        category: currentSelectedCategory,
        timeLimit: finalCount * 60, 
        questions: slicedQuestions,
        isTestOnly: false,
        authorId: auth.currentUser ? auth.currentUser.uid : "GUEST"
    };

    if (!checkIsMasterAdmin()) {
        mockGeneratedThisMonth++;
        db.collection("users").doc(auth.currentUser.uid).update({mockGeneratedThisMonth: mockGeneratedThisMonth});
    }

    prepareWelcomeScreen();
}

function prepareWelcomeScreen() {
    const titleEl = document.getElementById('selected-quiz-title'); if(titleEl) titleEl.innerText = activeQuiz.title;
    const btnPractice = document.getElementById('btn-practice'); const gridContainer = document.getElementById('welcome-action-buttons');
    if (activeQuiz.isTestOnly) {
        if(btnPractice) btnPractice.classList.add('hidden');
        if(gridContainer) gridContainer.classList.replace('sm:grid-cols-2', 'sm:grid-cols-1');
    } else {
        if(btnPractice) btnPractice.classList.remove('hidden');
        if(gridContainer) gridContainer.classList.replace('sm:grid-cols-1', 'sm:grid-cols-2');
    }
    switchScreen('welcome');
}

function startQuiz(practice) {
    if (typeof resetAntiCheat === 'function') resetAntiCheat();

    const nameInputEl = document.getElementById('student-name');
    const nameInput = nameInputEl ? nameInputEl.value.trim() : "";
    if (!nameInput) return showToast("Vui lòng xác nhận Họ và Tên trước khi bắt đầu.", true);
    
    studentName = nameInput; isPracticeMode = practice; isReviewMode = false; tabSwitchCount = 0;
    activeQuiz = JSON.parse(JSON.stringify(activeQuiz));

    let shouldLoadSaved = false;
    if (checkFeatureAccess('autosave', true)) {
        const savedData = localStorage.getItem('quizProgress_' + activeQuiz.id);
        if (savedData) {
            if (confirm("Hệ thống phát hiện tiến trình chưa hoàn thành. Bạn có muốn tiếp tục bài làm không?")) {
                const parsed = JSON.parse(savedData);
                userAnswers = parsed.userAnswers;
                flaggedQuestions = parsed.flaggedQuestions;
                timeLeft = parsed.timeLeft;
                if (parsed.shuffledQuestions) activeQuiz.questions = parsed.shuffledQuestions;
                shouldLoadSaved = true;
            } else {
                localStorage.removeItem('quizProgress_' + activeQuiz.id);
            }
        }
    }

    if (!shouldLoadSaved) {
        let passageMap = new Map();
        activeQuiz.questions.forEach(q => {
            let p = q.passage || "";
            if (!passageMap.has(p)) passageMap.set(p, []);
            passageMap.get(p).push(q);
        });
        
        let groupedQuestions = Array.from(passageMap.values());

        for (let i = groupedQuestions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [groupedQuestions[i], groupedQuestions[j]] = [groupedQuestions[j], groupedQuestions[i]];
        }

        groupedQuestions.forEach(group => {
            if (!group[0].passage || group[0].passage.trim() === "") {
                for (let i = group.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [group[i], group[j]] = [group[j], group[i]];
                }
            }

            // CHỈ TRỘN ĐÁP ÁN NẾU LÀ TRẮC NGHIỆM
            group.forEach(q => {
                if (!q.type || q.type === "mcq") {
                    let opts = q.options.map((text, idx) => ({ 
                        text: text, isCorrect: idx === q.correctAnswer,
                        explanation: (q.optionExplanations && q.optionExplanations[idx]) ? q.optionExplanations[idx] : ""
                    }));
                    for (let i = opts.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [opts[i], opts[j]] = [opts[j], opts[i]];
                    }
                    q.options = opts.map(o => o.text);
                    q.correctAnswer = opts.findIndex(o => o.isCorrect);
                    q.optionExplanations = opts.map(o => o.explanation);
                }
            });
        });

        activeQuiz.questions = groupedQuestions.flat();
        userAnswers = new Array(activeQuiz.questions.length).fill(null);
        flaggedQuestions = new Array(activeQuiz.questions.length).fill(false);
        timeLeft = activeQuiz.timeLimit;
    }
    
    currentFilter = 'all';
    const fPract = document.getElementById('filter-tabs-practice'); const fRev = document.getElementById('filter-tabs-review');
    if(fPract) fPract.classList.replace('hidden', 'grid');
    if(fRev) fRev.classList.replace('grid', 'hidden');
    resetFilterButtons(fPract);

    const dName = document.getElementById('display-student-name'); if(dName) dName.innerText = studentName;
    const qTitle = document.getElementById('quiz-header-title'); if(qTitle) qTitle.innerText = activeQuiz.title;
    const eBar = document.getElementById('energy-bar-container'); if(eBar) eBar.classList.remove('hidden');

    switchScreen('quiz');
    loadQuestion(0);

    if (!isPracticeMode) {
        enterFullscreen();
        startTimer();
    } else {
        const timeText = document.getElementById('time-text');
        if (timeText) timeText.innerText = "Không giới hạn";
        if (eBar) eBar.classList.add('hidden');
    }
}

function setFilter(type, btnElement) {
    currentFilter = type;
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-1'));
    if(btnElement) btnElement.classList.add('ring-2', 'ring-blue-500', 'ring-offset-1');
    renderNavigator();
    
    // [VIP] Quét lại trạng thái Next/Prev ngay lập tức để khớp với tab lọc
    const prevIdx = getFilteredIndex(-1);
    const nextIdx = getFilteredIndex(1);
    const bPrev = document.getElementById('btn-prev'); if(bPrev) bPrev.disabled = prevIdx === -1;
    const bNext = document.getElementById('btn-next'); if(bNext) bNext.classList.toggle('hidden', nextIdx === -1);
    const bSub = document.getElementById('btn-submit'); if(bSub) bSub.classList.toggle('hidden', nextIdx !== -1 || isReviewMode);
}

function resetFilterButtons(container) {
    if(!container) return;
    container.querySelectorAll('.filter-btn').forEach((btn, index) => {
        btn.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-1');
        if (index === 0) btn.classList.add('ring-2', 'ring-blue-500', 'ring-offset-1'); 
    });
}

function renderNavigator() {
    const grid = document.getElementById('navigator-grid'); if(!grid) return; grid.innerHTML = '';
    
    activeQuiz.questions.forEach((_, i) => {
        let isDone = userAnswers[i] !== null; let isFlagged = flaggedQuestions[i];
        let isCorrect = isDone && userAnswers[i] === activeQuiz.questions[i].correctAnswer;
        let isWrong = isDone && userAnswers[i] !== activeQuiz.questions[i].correctAnswer;

        if (currentFilter === 'pending' && isDone) return;
        if (currentFilter === 'done' && !isDone) return;
        if (currentFilter === 'flagged' && !isFlagged) return;
        if (currentFilter === 'correct' && (!isDone || !isCorrect)) return;
        if (currentFilter === 'wrong' && (!isDone || !isWrong)) return;

        const btn = document.createElement('button'); btn.innerText = i + 1;
        let baseClass = 'w-10 h-10 rounded-lg font-bold text-sm flex items-center justify-center transition-all border-2 border-transparent ';
        
        if (isReviewMode) {
            if (isCorrect) baseClass += 'bg-green-500 text-white shadow-md';
            else if (isWrong) baseClass += 'bg-red-500 text-white shadow-md';
            else baseClass += 'bg-gray-200 text-gray-500 dark:bg-gray-700'; 
        } else {
            if (isFlagged) baseClass += 'bg-yellow-400 text-yellow-900 shadow-md'; 
            else if (isDone) baseClass += 'bg-blue-600 text-white shadow-md'; 
            else baseClass += 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'; 
        }

        if (i === currentQuestionIndex) baseClass += ' ring-2 ring-offset-2 ring-gray-800 dark:ring-white';
        btn.className = baseClass; btn.onclick = () => loadQuestion(i); grid.appendChild(btn);
    });
}

function toggleFlag() {
    flaggedQuestions[currentQuestionIndex] = !flaggedQuestions[currentQuestionIndex];
    loadQuestion(currentQuestionIndex); 
    if (currentFilter === 'flagged') renderNavigator(); 
    saveProgressLocally(); 
}

// =========================================================================
// [VIP SAAS] TRÁI TIM HỆ THỐNG: ĐỘNG CƠ RENDER ĐA CẤU TRÚC (THPTQG 2025)
// =========================================================================
function loadQuestion(index) {
    if(index < 0 || index >= activeQuiz.questions.length) return;
    currentQuestionIndex = index;
    const q = activeQuiz.questions[index];
    
    const counter = document.getElementById('question-counter'); if(counter) counter.innerText = `CÂU ${index + 1} / ${activeQuiz.questions.length}`;
    const content = document.getElementById('question-content'); if(content) content.innerHTML = q.content;
    const passageContainer = document.getElementById('passage-container');
    const questionWrapper = document.getElementById('question-wrapper'); const passageText = document.getElementById('passage-text');

    if (q.passage && q.passage.trim() !== "") {
        if(passageContainer) { passageContainer.classList.remove('hidden'); passageContainer.classList.add('flex'); }
        if(questionWrapper) questionWrapper.classList.replace('w-full', 'md:w-1/2');
        if(passageText) passageText.innerHTML = q.passage;
    } else {
        if(passageContainer) { passageContainer.classList.add('hidden'); passageContainer.classList.remove('flex'); }
        if(questionWrapper) questionWrapper.classList.replace('md:w-1/2', 'w-full');
        if(passageText) passageText.innerHTML = "";
    }

    const btnFlag = document.getElementById('btn-flag');
    if (btnFlag) {
        if (flaggedQuestions[index]) {
            btnFlag.className = 'flex-1 sm:flex-none justify-center flex items-center gap-2 px-4 py-2 bg-yellow-400 text-slate-900 border border-yellow-500 rounded-lg font-bold text-xs shadow-sm';
            btnFlag.innerHTML = `<i class="fas fa-flag text-[10px]"></i> Đang Phân Vân`;
        } else {
            btnFlag.className = 'flex-1 sm:flex-none justify-center flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-xs hover:bg-slate-50 hover:border-amber-200 transition-colors shadow-sm';
            btnFlag.innerHTML = `<i class="far fa-flag text-[10px]"></i> Cần Cân Nhắc`;
        }
    }
    
    const answerContainer = document.getElementById('dynamic-answer-container');
    if(answerContainer) {
        answerContainer.innerHTML = ''; 
        const hasExplanationAccess = checkFeatureAccess('explanation', true);

        // [VIP] KIỂM SOÁT KHÓA NÚT THÔNG MINH
        let isAnswerRevealed = false;
        if (q.type === "tf") {
            if (!Array.isArray(userAnswers[index])) userAnswers[index] = [null, null, null, null];
            // CHỈ KHÓA NÚT KHI ĐÃ TICK ĐỦ 4 Ý (Luyện tập) HOẶC ĐANG XEM LẠI BÀI
            isAnswerRevealed = isReviewMode || (isPracticeMode && userAnswers[index].every(a => a !== null));
        } else {
            isAnswerRevealed = isReviewMode || (isPracticeMode && userAnswers[index] !== null && userAnswers[index] !== "");
        }

        // --- NHÁNH 1: TRẮC NGHIỆM ĐA LỰA CHỌN (4 CHỌN 1) ---
        if (!q.type || q.type === "mcq") {
            const labels = ['A', 'B', 'C', 'D'];
            const gridOpts = document.createElement('div');
            gridOpts.className = "grid grid-cols-1 gap-3.5";

            q.options.forEach((optText, optIndex) => {
                let cleanText = optText;
                let optExpText = (q.optionExplanations && q.optionExplanations[optIndex]) ? q.optionExplanations[optIndex] : "";
                
                // Dọn rác nếu ngài lỡ nhập thủ công sai
                if (cleanText.includes("::")) {
                    let parts = cleanText.split('::');
                    cleanText = parts[0].trim();
                    if (!optExpText) optExpText = parts[1].replace(/đúng|sai/gi, '').replace(/^[.,\-\s]+/, '').trim();
                }

                const btn = document.createElement('button');
                if (!hasExplanationAccess) optExpText = ""; 

                let expBlock = ''; let labelBg = 'bg-slate-100 dark:bg-slate-800'; let labelText = 'text-slate-500 dark:text-slate-400';
                let btnBorder = 'border-slate-200 dark:border-slate-700/60'; let btnBg = 'bg-white dark:bg-[#1E293B]';

                if (isAnswerRevealed) {
                    btn.style.pointerEvents = 'none';
                    if (optIndex === q.correctAnswer) {
                        btnBorder = 'border-green-500 dark:border-green-500'; btnBg = 'bg-green-50/50 dark:bg-green-950/20'; labelBg = 'bg-green-500'; labelText = 'text-white';
                        if (optExpText) {
                            expBlock = `<div class="mt-3 pl-14 text-xs sm:text-sm text-green-700 dark:text-green-400 text-left font-semibold"><i class="fas fa-check-circle mr-1"></i> ${optExpText}</div>`;
                        }
                    } else if (optIndex === userAnswers[index]) {
                        btnBorder = 'border-red-500 dark:border-red-500'; btnBg = 'bg-red-50/50 dark:bg-red-950/20'; labelBg = 'bg-red-500'; labelText = 'text-white';
                        if (optExpText) {
                            expBlock = `<div class="mt-3 pl-14 text-xs sm:text-sm text-red-700 dark:text-red-400 text-left font-semibold"><i class="fas fa-times-circle mr-1"></i> ${optExpText}</div>`;
                        }
                    }
                } else {
                    if (userAnswers[index] === optIndex) {
                        btnBorder = 'border-blue-600 dark:border-blue-500'; btnBg = 'bg-blue-50/40 dark:bg-blue-900/20'; btn.classList.add('ring-2', 'ring-blue-600/20'); labelBg = 'bg-blue-600 dark:bg-blue-500'; labelText = 'text-white';
                    }
                    btn.onclick = () => { 
                        userAnswers[currentQuestionIndex] = optIndex; 
                        loadQuestion(currentQuestionIndex); 
                        saveProgressLocally(); 
                    };

                    btn.addEventListener('contextmenu', (e) => {
                        e.preventDefault();
                        if(!checkFeatureAccess('crossout')) return;
                        btn.classList.toggle('opacity-30'); btn.classList.toggle('line-through'); btn.classList.toggle('grayscale');
                    });
                }

                btn.className = `option-btn text-left p-4 rounded-xl flex flex-col border transition-all w-full shadow-sm ${btnBorder} ${btnBg} ${isAnswerRevealed ? 'cursor-default' : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50'}`;
                btn.innerHTML = `<div class="flex items-center gap-4 w-full"><span class="w-10 h-10 flex items-center justify-center rounded-lg ${labelBg} font-mono font-bold ${labelText} shrink-0 text-base shadow-sm">${labels[optIndex]}</span><span class="text-base font-medium text-slate-800 dark:text-slate-200">${cleanText}</span></div>${expBlock}`;
                gridOpts.appendChild(btn);
            });
            answerContainer.appendChild(gridOpts);
        }
        
        // --- NHÁNH 2: TRẮC NGHIỆM ĐÚNG/SAI ĐỘC LẬP ---
        else if (q.type === "tf") {
            const labels = ['A', 'B', 'C', 'D'];
            const wrapper = document.createElement('div');
            wrapper.className = "flex flex-col gap-3.5";

            q.options.forEach((optText, optIndex) => {
                let cleanText = optText;
                let optExpText = (q.explanations && q.explanations[optIndex]) ? q.explanations[optIndex] : "";
                
                // Dọn sạch mã thừa do lưu thủ công
                if (cleanText.includes("::")) {
                    let parts = cleanText.split('::');
                    cleanText = parts[0].trim();
                    if (!optExpText) optExpText = parts[2] ? parts[2].trim() : parts[1].replace(/đúng|sai/gi, '').replace(/^[.,\-\s]+/, '').trim();
                }

                const row = document.createElement('div');
                row.className = "flex flex-col p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200/60 dark:border-slate-700/60 shadow-sm";
                
                const mainRow = document.createElement('div');
                mainRow.className = "flex flex-col sm:flex-row gap-4 justify-between items-stretch sm:items-center w-full";

                const textCol = document.createElement('div');
                textCol.className = "flex gap-3.5 text-base font-medium text-slate-800 dark:text-slate-200 flex-1";
                textCol.innerHTML = `<span class="font-mono font-bold text-slate-400">${labels[optIndex]}.</span> <span>${cleanText}</span>`;
                
                const btnCol = document.createElement('div');
                btnCol.className = "flex gap-2 shrink-0";
                
                const btnTrue = document.createElement('button'); btnTrue.innerText = "ĐÚNG";
                const btnFalse = document.createElement('button'); btnFalse.innerText = "SAI";
                
                let baseBtnClass = "px-5 py-2 rounded-lg font-bold text-xs border transition-all shadow-sm flex-1 sm:flex-none ";
                let trueBg = "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-green-500";
                let falseBg = "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-red-500";

                if (isAnswerRevealed) {
                    btnTrue.style.pointerEvents = 'none'; btnFalse.style.pointerEvents = 'none';
                    let correctVal = q.correctAnswers[optIndex]; 
                    let userVal = userAnswers[index][optIndex];
                    
                    if (userVal === true) trueBg = correctVal === true ? "bg-green-500 text-white border-green-500" : "bg-red-500 text-white border-red-500";
                    else if (userVal === false) falseBg = correctVal === false ? "bg-green-500 text-white border-green-500" : "bg-red-500 text-white border-red-500";
                    
                    if (correctVal === true && userVal !== true) trueBg = "bg-green-100 dark:bg-green-950/30 text-green-600 dark:text-green-400 border-green-500 border-dashed animate-pulse";
                    if (correctVal === false && userVal !== false) falseBg = "bg-green-100 dark:bg-green-950/30 text-green-600 dark:text-green-400 border-green-500 border-dashed animate-pulse";
                } else {
                    if (userAnswers[index][optIndex] === true) trueBg = "bg-green-600 text-white border-green-600 ring-2 ring-green-100 dark:ring-green-900/30";
                    if (userAnswers[index][optIndex] === false) falseBg = "bg-red-600 text-white border-red-600 ring-2 ring-red-100 dark:ring-red-900/30";
                    
                    btnTrue.onclick = () => { userAnswers[currentQuestionIndex][optIndex] = true; loadQuestion(currentQuestionIndex); saveProgressLocally(); };
                    btnFalse.onclick = () => { userAnswers[currentQuestionIndex][optIndex] = false; loadQuestion(currentQuestionIndex); saveProgressLocally(); };
                }

                btnTrue.className = baseBtnClass + trueBg; btnFalse.className = baseBtnClass + falseBg;
                btnCol.appendChild(btnTrue); btnCol.appendChild(btnFalse);
                
                mainRow.appendChild(textCol); mainRow.appendChild(btnCol);
                row.appendChild(mainRow);

                if (isAnswerRevealed && optExpText && hasExplanationAccess) {
                    let expHTML = `<div class="w-full mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 text-xs sm:text-sm rounded-lg border border-blue-100 dark:border-blue-800/50"><i class="fas fa-info-circle mr-1"></i> <strong>Giải thích:</strong> ${optExpText}</div>`;
                    row.insertAdjacentHTML('beforeend', expHTML);
                }

                wrapper.appendChild(row);
            });
            answerContainer.appendChild(wrapper);
        }

        // --- NHÁNH 3: TRẢ LỜI NGẮN (TỰ LUẬN ĐIỀN SỐ/CHỮ) ---
        else if (q.type === "sa") {
            const wrapper = document.createElement('div');
            wrapper.className = "flex flex-col gap-4";
            
            const inputEl = document.createElement('input');
            inputEl.type = "text";
            inputEl.placeholder = "Nhập câu trả lời ngắn của bạn vào đây...";
            inputEl.className = "w-full p-4 border rounded-xl text-lg font-bold text-slate-800 dark:text-white dark:bg-slate-900 outline-none shadow-inner border-slate-200 dark:border-slate-800 focus:border-blue-500 dark:focus:border-blue-400 transition-all";
            
            if (userAnswers[index] !== null) inputEl.value = userAnswers[index];

            if (isAnswerRevealed) {
                inputEl.readOnly = true;
                const userAnsStr = (userAnswers[index] || "").toString().trim().toLowerCase();
                const correctAnsStr = (q.correctAnswer || "").toString().trim().toLowerCase();
                
                if (userAnsStr === correctAnsStr) {
                    inputEl.className += " border-green-500 bg-green-50/50 dark:bg-green-950/20 text-green-600 dark:text-green-400";
                } else {
                    inputEl.className += " border-red-500 bg-red-50/50 dark:bg-red-950/20 text-red-600 dark:text-red-400";
                    const corrBadge = document.createElement('div');
                    corrBadge.className = "text-sm text-green-700 dark:text-green-400 font-bold bg-green-50 dark:bg-green-950/20 px-4 py-3 rounded-xl border border-green-200 dark:border-green-900/40 flex items-center gap-2";
                    corrBadge.innerHTML = `<i class="fas fa-check-circle"></i> Hệ thống đối soát đáp án chuẩn: <span class="font-mono underline">${q.correctAnswer}</span>`;
                    wrapper.appendChild(corrBadge);
                }
            } else {
                inputEl.oninput = (e) => {
                    userAnswers[currentQuestionIndex] = e.target.value.trim() === "" ? null : e.target.value;
                    saveProgressLocally(); renderNavigator();
                };
            }
            wrapper.insertBefore(inputEl, wrapper.firstChild);
            answerContainer.appendChild(wrapper);
        }
    }

    const hintBtn = document.getElementById('btn-hint'); const hintBox = document.getElementById('hint-box');
    if(hintBox) hintBox.classList.add('hidden');
    if(hintBtn) {
        if (isPracticeMode && !isReviewMode && q.hint && !isAnswerRevealed) hintBtn.classList.remove('hidden');
        else hintBtn.classList.add('hidden');
    }

    const prevIdx = getFilteredIndex(-1); const nextIdx = getFilteredIndex(1);
    const bPrev = document.getElementById('btn-prev'); if(bPrev) bPrev.disabled = prevIdx === -1;
    const bNext = document.getElementById('btn-next'); if(bNext) bNext.classList.toggle('hidden', nextIdx === -1);
    const bSub = document.getElementById('btn-submit'); if(bSub) bSub.classList.toggle('hidden', nextIdx !== -1 || isReviewMode);

    const explanationBox = document.getElementById('explanation-box');
    // KHÔNG TÍNH q.type === "tf" VÀO ĐÂY NỮA VÌ TF ĐÃ CÓ GIẢI THÍCH RIÊNG TỪNG Ý BÊN TRÊN
    const isAnswerRevealedGlobal = isReviewMode || (isPracticeMode && userAnswers[index] !== null && q.type !== "tf");
    
    if (explanationBox) {
        const eText = document.getElementById('explanation-text');
        if (isAnswerRevealedGlobal && q.explanation && q.explanation !== "Tạo tự động từ dữ liệu văn bản." && q.explanation !== "Chưa có giải thích.") {
            if(!checkFeatureAccess('explanation', true)) {
                if(eText) eText.innerHTML = `<span class="text-slate-400 italic"><i class="fas fa-lock text-amber-500"></i> Xem phân tích giải nghĩa chi tiết yêu cầu kích hoạt gói cước. <a href="#" onclick="switchScreen('pricing')" class="text-blue-500 font-bold underline">Nâng cấp gói</a>.</span>`;
                explanationBox.classList.remove('hidden');
            } else {
                if(eText) eText.innerText = q.explanation;
                explanationBox.classList.remove('hidden');
            }
        } else {
            explanationBox.classList.add('hidden');
        }
    }
    renderNavigator(); 
}

function startTimer() {
    const energyFill = document.getElementById('energy-fill'); const timeText = document.getElementById('time-text');
    const totalTime = activeQuiz.timeLimit;
    timerInterval = setInterval(() => {
        timeLeft--; let percentage = (timeLeft / totalTime) * 100;
        if(energyFill) energyFill.style.width = percentage + '%';
        if(timeText) {
            timeText.innerText = `${Math.floor(timeLeft / 60).toString().padStart(2, '0')}:${(timeLeft % 60).toString().padStart(2, '0')}`;
            if (percentage <= 15) { energyFill.className = 'energy-fill bg-danger pulse-active'; timeText.className = 'font-mono font-bold text-2xl sm:text-3xl text-red-600 tabular-nums'; } 
            else if (percentage <= 50) { energyFill.className = 'energy-fill bg-warn'; timeText.className = 'font-mono font-bold text-2xl sm:text-3xl text-amber-600 tabular-nums'; } 
            else { energyFill.className = 'energy-fill bg-safe'; timeText.className = 'font-mono font-bold text-2xl sm:text-3xl text-blue-900 dark:text-white tabular-nums'; }
        }
        if (timeLeft <= 0) {
            clearInterval(timerInterval); showToast("Đã hết thời gian làm bài. Hệ thống đang tự động nộp bài...", false); submitQuiz(true);
        }
    }, 1000);
}

function handleVisibilityChange() {
    if (document.hidden && !isPracticeMode && !isReviewMode && screens.quiz && !screens.quiz.classList.contains('hidden')) {
        if (++tabSwitchCount >= 2) { 
            showToast("Hệ thống phát hiện thao tác rời khỏi màn hình thi 2 lần. Bài thi tự động được nộp.", true); 
            submitQuiz(true); 
        } else { showToast("Nhắc nhở: Không chuyển sang màn hình khác trong quá trình thi thử.", true); }
    }
}

// [VIP CẤP CỨU] Thuật Toán Chấm Điểm Lũy Tiến Toàn Cục & Quy Đổi Thang 10 (THPTQG 2025)
function submitQuiz(force) {
    const timeUsed = activeQuiz.timeLimit - (timeLeft > 0 ? timeLeft : 0);
    const minimumTime = Math.floor(activeQuiz.timeLimit / 2);

    if (!force && timeUsed < minimumTime && !isPracticeMode) {
        showToast("Hệ thống khóa lệnh nộp bài sớm. Vui lòng làm bài tối thiểu 50% thời gian quy định.", true);
        return; 
    }

    if (force || confirm("Xác nhận nộp bài khảo thí? Dữ liệu điểm số sẽ được đồng bộ lên máy chủ.")) {
        clearInterval(timerInterval); exitFullscreen();
        localStorage.removeItem('quizProgress_' + activeQuiz.id);

        let totalRawScore = 0; // Điểm thô cộng dồn
        activeQuiz.questions.forEach((q, i) => {
            const uAns = userAnswers[i];
            
            // PHẦN I: Trắc nghiệm (0.25đ / câu thô)
            if (!q.type || q.type === "mcq") {
                if (uAns !== null && uAns === q.correctAnswer) totalRawScore += 0.25;
            } 
            // PHẦN II: Đúng/Sai (0.1 - 0.25 - 0.5 - 1.0 thô)
            else if (q.type === "tf") {
                if (Array.isArray(uAns)) {
                    let matchCount = 0;
                    for(let j=0; j<4; j++) {
                        if (uAns[j] !== null && uAns[j] === q.correctAnswers[j]) matchCount++;
                    }
                    if (matchCount === 1) totalRawScore += 0.1;
                    else if (matchCount === 2) totalRawScore += 0.25;
                    else if (matchCount === 3) totalRawScore += 0.5;
                    else if (matchCount === 4) totalRawScore += 1.0;
                }
            }
            // PHẦN III: Trả lời ngắn (0.5đ / câu thô)
            else if (q.type === "sa") {
                if (uAns !== null && uAns.toString().trim().toLowerCase() === q.correctAnswer.toString().trim().toLowerCase()) {
                    totalRawScore += 0.5;
                }
            }
        });

        // TÍNH TOÁN ĐIỂM TRẦN THÔ DỰA TRÊN CẤU TRÚC ĐỀ
        let maxRawScore = activeQuiz.questions.reduce((acc, q) => {
            if (q.type === "tf") return acc + 1.0;
            if (q.type === "sa") return acc + 0.5;
            return acc + 0.25;
        }, 0);

        // [QUAN TRỌNG] QUY ĐỔI VỀ THANG ĐIỂM 10 CHUẨN
        let percent = maxRawScore > 0 ? Math.round((totalRawScore / maxRawScore) * 100) : 0;
        let finalScore10 = maxRawScore > 0 ? (totalRawScore / maxRawScore) * 10 : 0;
        let scoreDisplay = `${finalScore10.toFixed(2)}/10`; // Format đẹp: 8.50/10 hoặc 9.25/10

        const finalTimeUsed = activeQuiz.timeLimit - (timeLeft > 0 ? timeLeft : 0);
        const timeUsedStr = `${Math.floor(finalTimeUsed / 60).toString().padStart(2, '0')}:${(finalTimeUsed % 60).toString().padStart(2, '0')}`;
        
        switchScreen('result');
        const sc = document.getElementById('result-score'); if(sc) sc.innerText = scoreDisplay;
        const pc = document.getElementById('result-percent'); if(pc) pc.innerText = `${percent}%`;
        const tc = document.getElementById('result-time'); if(tc) tc.innerText = isPracticeMode ? "Luyện tập" : timeUsedStr;

        const rawPayload = {
            quizId: activeQuiz.id || "UNKNOWN", quizTitle: activeQuiz.title || "Chưa đặt tên", category: activeQuiz.category || "Chưa phân loại",
            studentName: studentName || "Ẩn danh", email: auth.currentUser ? auth.currentUser.email : "Ẩn danh", uid: auth.currentUser ? auth.currentUser.uid : "UNKNOWN",
            score: scoreDisplay, percentage: percent, timeUsed: isPracticeMode ? "Luyện tập" : timeUsedStr,
            teacherId: activeQuiz.authorId || "GUEST", userAnswers: userAnswers || [], quizQuestionsSnapshot: activeQuiz.questions || []
        };

        const cleanPayload = JSON.parse(JSON.stringify(rawPayload));
        cleanPayload.timestamp = firebase.firestore.FieldValue.serverTimestamp();

        db.collection("results").add(cleanPayload).catch(err => {
            console.error("Lỗi cập nhật đám mây: ", err);
            showToast("Lỗi đồng bộ: Không thể kết nối với Firestore đám mây", true);
        });
        // [VIP] CỘNG ĐIỂM UY TÍN CHO THƯ VIỆN CỘNG ĐỒNG KHI NỘP BÀI THÀNH CÔNG
        if (!isPracticeMode && isSharedMode && activeQuiz.authorId) {
            const folderId = `${activeQuiz.authorId}_${activeQuiz.category}`.replace(/\s+/g, '_');
            db.collection("community_folders").doc(folderId).update({
                completionCount: firebase.firestore.FieldValue.increment(1)
            }).catch(e => console.warn("Bỏ qua cộng điểm (Không phải thư mục Public)"));
        }
    }
}

function reviewQuiz() {
    isReviewMode = true; switchScreen('quiz');
    const eb = document.getElementById('energy-bar-container'); if(eb) eb.classList.add('hidden');
    
    currentFilter = 'all';
    const fp = document.getElementById('filter-tabs-practice'); if(fp) fp.classList.replace('grid', 'hidden');
    const fr = document.getElementById('filter-tabs-review'); if(fr) fr.classList.replace('hidden', 'grid');
    resetFilterButtons(fr); loadQuestion(0);
}

// --- 9. ADMIN ZONE ---
function switchAdminTab(tab) {
    document.getElementById('panel-smart').classList.toggle('hidden', tab !== 'smart');
    document.getElementById('panel-manual').classList.toggle('hidden', tab !== 'manual');
    document.getElementById('panel-stats').classList.toggle('hidden', tab !== 'stats');
    document.getElementById('panel-users').classList.toggle('hidden', tab !== 'users');
    
    const tabs = ['smart', 'manual', 'stats', 'users'];
    // Style mới: Tab vuông vức, nền trắng khi active (giống Stripe)
    tabs.forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        if(!btn) return;
        if (t === tab) {
            btn.className = `flex-1 md:flex-none px-4 py-2 text-xs sm:text-sm font-bold rounded-lg transition-all bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm border border-slate-200/50 dark:border-slate-700 flex items-center justify-center gap-1.5`;
        } else {
            btn.className = `flex-1 md:flex-none px-4 py-2 text-xs sm:text-sm font-bold rounded-lg transition-all text-slate-500 hover:text-slate-900 dark:hover:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 flex items-center justify-center gap-1.5 border border-transparent`;
        }
    });
    
    if (tab === 'stats') fetchResultsFromFirebase();
}

// [VIP] THỐNG KÊ ĐIỂM GIÁO VIÊN - TẢI SIÊU TỐC 0MS VÀ CHỐNG TREO MÁY
function fetchResultsFromFirebase() {
    const tableBody = document.getElementById('stats-table-body'); if(!tableBody) return;
    
    // Hiệu ứng xoay vòng đẹp mắt trong lúc chờ (tối đa vài mili-giây)
    tableBody.innerHTML = '<tr><td colspan="6" class="text-center py-8"><i class="fas fa-spinner fa-spin text-blue-500 text-2xl mb-2"></i><br><span class="text-gray-500">Đang trích xuất sổ điểm...</span></td></tr>';
    if (!auth.currentUser) return;

    // [VIP] BẢO HIỂM CHỐNG ĐỨNG MÁY: Quá 5 giây mạng lag tự động ngắt!
    let isFetched = false;
    const timeoutId = setTimeout(() => {
        if (!isFetched) {
            tableBody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-red-500 font-bold"><i class="fas fa-wifi mb-2 text-2xl"></i><br>Mạng chậm hoặc máy chủ quá tải. Vui lòng ấn "Làm mới".</td></tr>';
        }
    }, 5000);

    // [VIP] THUẬT TOÁN RÚT GỌN: Chỉ lấy 100 bài nộp mới nhất để chống sập RAM
    db.collection("results")
      .where("teacherId", "==", auth.currentUser.uid)
      .limit(100) 
      .get().then((snapshot) => {
        isFetched = true;
        clearTimeout(timeoutId);
        tableBody.innerHTML = '';
        
        if (snapshot.empty) { tableBody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-500">Chưa có dữ liệu bài làm của học sinh.</td></tr>'; return; }

        let results = []; 
        snapshot.forEach(doc => results.push(doc.data()));
        
        // Sắp xếp bài mới nhất lên đầu
        results.sort((a, b) => { 
            let timeA = a.timestamp && a.timestamp.seconds ? a.timestamp.seconds : 0; 
            let timeB = b.timestamp && b.timestamp.seconds ? b.timestamp.seconds : 0; 
            return timeB - timeA; 
        });

        // Vẽ bảng điểm vinh danh
        results.forEach((res) => {
            const formatStr = (res.timestamp && res.timestamp.seconds) ? new Date(res.timestamp.seconds * 1000).toLocaleString('vi-VN') : "Vừa xong";
            const row = document.createElement('tr'); 
            row.className = 'border-b dark:border-gray-700 text-sm hover:bg-blue-50 dark:hover:bg-gray-700/50 transition-colors';
            
            row.innerHTML = `
                <td class="p-3 sm:p-4 font-semibold text-gray-900 dark:text-gray-100">${res.studentName || "Ẩn danh"}</td>
                <td class="p-3 sm:p-4 text-gray-600 dark:text-gray-400">
                    <div class="font-bold text-blue-700 dark:text-blue-400 truncate max-w-[200px]" title="${res.quizTitle}">${res.quizTitle || "Bài thi"}</div>
                    <div class="text-[0.65rem] sm:text-xs mt-1"><span class="px-2 py-0.5 bg-gray-100 dark:bg-gray-600 rounded-md border dark:border-gray-500">${res.category || "Chưa phân loại"}</span></div>
                </td>
                <td class="p-3 sm:p-4 font-mono font-bold text-gray-800 dark:text-gray-200">${res.score || "0/0"}</td>
                <td class="p-3 sm:p-4 font-bold ${res.percentage >= 50 ? 'text-green-600' : 'text-red-500'}">${res.percentage || 0}%</td>
                <td class="p-3 sm:p-4 text-gray-500 dark:text-gray-400 font-mono">${res.timeUsed || "--:--"}</td>
                <td class="p-3 sm:p-4 text-gray-400 text-xs">${formatStr}</td>
            `;
            tableBody.appendChild(row);
        });
    }).catch(err => { 
        isFetched = true;
        clearTimeout(timeoutId);
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-red-500 font-bold"><i class="fas fa-exclamation-triangle mb-2 text-2xl"></i><br>Lỗi máy chủ Firebase.</td></tr>'; 
    });
}

let currentSmartQuestions = [];
// =========================================================================
// [VIP] ĐỘNG CƠ BIÊN DỊCH VĂN BẢN THÔNG MINH (PHIÊN BẢN CHUẨN XÁC TUYỆT ĐỐI)
// =========================================================================
window.processSmartText = function() {
    let text = document.getElementById('smart-input-area').value;
    text = text.replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ');
    const regex = /(?=\[Bài đọc\]|\[Hết bài đọc\]|Câu \d+[:.])/i;
    const blocks = text.split(regex).filter(q => q.trim().length > 0);
    
    currentSmartQuestions = []; let currentPassage = ""; let previewHTML = "";
    
    blocks.forEach((block) => {
        let trimmed = block.trim();
        if (trimmed.match(/^\[Bài đọc\]/i)) { 
            currentPassage = trimmed.replace(/^\[Bài đọc\]/i, '').trim(); 
        } else if (trimmed.match(/^\[Hết bài đọc\]/i)) { 
            currentPassage = ""; 
        } else if (trimmed.match(/^Câu \d+[:.]/i)) {
            let content = trimmed.split('\n')[0].replace(/^Câu \d+[:.]/i, '').trim();
            let body = trimmed.substring(trimmed.indexOf('\n') + 1).trim();

            // --- NHÁNH 1: TRẢ LỜI NGẮN (SA) ---
            if (body.match(/^(Đáp án|Đ\/a)[:\-]/i)) {
                let parts = body.replace(/^(Đáp án|Đ\/a)[:\-]/i, '').split('::');
                let ans = parts[0].trim();
                let exp = parts[1] ? parts[1].trim() : "";
                if (ans) {
                    currentSmartQuestions.push({ type: "sa", content, correctAnswer: ans, explanation: exp, passage: currentPassage });
                    previewHTML += `
                        <div class="p-4 bg-white dark:bg-slate-800 border border-green-200 dark:border-green-800/50 rounded-xl mb-4 shadow-sm">
                            <p class="text-sm font-bold text-slate-800 dark:text-slate-200 mb-3">Câu ${currentSmartQuestions.length} (Trả lời ngắn): ${content}</p>
                            <div class="bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 p-2.5 rounded-lg text-sm font-mono border border-green-100 dark:border-green-800/50"><i class="fas fa-key mr-2"></i> ${ans}</div>
                        </div>`;
                }
            }
            // --- NHÁNH 2: TRẮC NGHIỆM ĐÚNG/SAI (TF) ---
            else if (body.match(/^[a-d]\.\s/m) && (body.toLowerCase().includes(":: đúng") || body.toLowerCase().includes(":: sai") || body.toLowerCase().includes("::đúng") || body.toLowerCase().includes("::sai"))) {
                let options = []; let correctAnswers = []; let explanations = [];
                let lines = body.split('\n').filter(l => l.trim().length > 0);
                
                lines.forEach(line => {
                    if (options.length < 4 && line.match(/^[a-d]\.\s/)) {
                        let parts = line.replace(/^[a-d]\.\s*/, '').split('::');
                        let textOnly = parts[0].trim();
                        let truthValue = false;
                        let exp = "";
                        
                        if (parts[1]) {
                            let val = parts[1].trim().toLowerCase();
                            if (val.startsWith("đúng") || val.startsWith("t")) truthValue = true;
                            
                            if (parts[2]) {
                                exp = parts[2].trim();
                            } else {
                                let expMatch = parts[1].match(/đúng[.,]*\s*(.*)|sai[.,]*\s*(.*)/i);
                                if (expMatch && (expMatch[1] || expMatch[2])) exp = (expMatch[1] || expMatch[2]).trim();
                            }
                        }
                        options.push(textOnly);
                        correctAnswers.push(truthValue);
                        explanations.push(exp);
                    }
                });
                
                if (options.length === 4) {
                    currentSmartQuestions.push({ type: "tf", content, options, correctAnswers, explanations, passage: currentPassage });
                    
                    let optsHTML = options.map((opt, idx) => `
                        <div class="flex items-start gap-3 mt-2.5 text-sm text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 p-2 rounded-lg border border-slate-100 dark:border-slate-700">
                            <span class="font-bold uppercase w-5 shrink-0 text-slate-400">${['a','b','c','d'][idx]}.</span>
                            <span class="flex-1">${opt}</span>
                            <span class="font-bold ${correctAnswers[idx] ? 'text-green-600 bg-green-50 dark:bg-green-900/30' : 'text-red-500 bg-red-50 dark:bg-red-900/30'} px-2 py-0.5 rounded text-xs">[${correctAnswers[idx] ? 'ĐÚNG' : 'SAI'}]</span>
                        </div>
                    `).join('');

                    previewHTML += `
                        <div class="p-4 bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-800/50 rounded-xl mb-4 shadow-sm">
                            <p class="text-sm font-bold text-slate-800 dark:text-slate-200 mb-3">Câu ${currentSmartQuestions.length} (Đúng/Sai): ${content}</p>
                            <div class="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700/60 shadow-inner">
                                ${optsHTML}
                            </div>
                        </div>`;
                } else {
                    let c = content.substring(0, 40) + "...";
                    previewHTML += `<div class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 rounded-xl text-sm text-red-600 dark:text-red-400 mb-4 shadow-sm font-bold"><i class="fas fa-exclamation-triangle mr-2 text-lg"></i> Lỗi định dạng Đ/S tại: ${c} (Không tìm đủ 4 ý a, b, c, d thường)</div>`;
                }
            }
            // --- NHÁNH 3: TRẮC NGHIỆM 4 CHỌN 1 (MCQ) ---
            else {
                // [VÁ LỖI CỰC MẠNH] Thêm (?:^|\n)\s* để BẮT BUỘC A, B, C, D phải nằm ở ĐẦU DÒNG (ngăn chặn lỗi "Tire-d::")
                let parseRegex = /(?:^|\n)\s*([*#]*)[Aa]\s*[.)\-:/]([\s\S]*?)(?:^|\n)\s*([*#]*)[Bb]\s*[.)\-:/]([\s\S]*?)(?:^|\n)\s*([*#]*)[Cc]\s*[.)\-:/]([\s\S]*?)(?:^|\n)\s*([*#]*)[Dd]\s*[.)\-:/]([\s\S]*)/i;
                let match = body.match(parseRegex);
                if (match) {
                    let rawOpts = [match[2], match[4], match[6], match[8]];
                    let opts = [], exps = [];
                    let correctIndex = -1;
                    
                    rawOpts.forEach((o, idx) => {
                        let p = o.split('::');
                        opts.push(p[0].trim());
                        let exp = p[1] ? p[1].trim() : "";
                        exps.push(exp);
                        
                        // match[1] là đánh dấu A, match[3] là B, match[5] là C, match[7] là D
                        if (match[idx * 2 + 1].includes('*') || exp.toLowerCase().startsWith("đúng")) {
                            correctIndex = idx;
                        }
                    });
                    
                    if (correctIndex === -1) correctIndex = 0; 

                    currentSmartQuestions.push({ type: "mcq", content, options: opts, optionExplanations: exps, correctAnswer: correctIndex, passage: currentPassage });
                    
                    let optsHTML = opts.map((opt, idx) => `
                        <div class="flex items-start gap-3 mt-2 text-sm p-2 rounded-lg ${correctIndex === idx ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 font-bold border border-blue-100 dark:border-blue-800' : 'text-slate-600 dark:text-slate-300 border border-transparent'}">
                            <span class="w-5 shrink-0">${['A','B','C','D'][idx]}.</span>
                            <span class="flex-1">${opt}</span>
                        </div>
                    `).join('');

                    previewHTML += `
                        <div class="p-4 bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-800/50 rounded-xl mb-4 shadow-sm">
                            <p class="text-sm font-bold text-slate-800 dark:text-slate-200 mb-3">Câu ${currentSmartQuestions.length} (Trắc nghiệm 4 lựa chọn): ${content}</p>
                            ${optsHTML}
                        </div>`;
                } else {
                    let c = content.substring(0, 40) + "...";
                    previewHTML += `<div class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 rounded-xl text-sm text-red-600 dark:text-red-400 mb-4 shadow-sm font-bold"><i class="fas fa-exclamation-triangle mr-2 text-lg"></i> Sai định dạng tại: ${c}</div>`;
                }
            }
        }
    });

    const sqc = document.getElementById('smart-question-count'); 
    if (sqc) sqc.innerText = `Đã nhận diện: ${currentSmartQuestions.length} câu`;
    
    const spb = document.getElementById('smart-preview-box');
    if (spb) {
        if (previewHTML === "") {
            spb.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-slate-400"><i class="fas fa-magic text-4xl mb-3 opacity-20"></i><p class="text-sm font-medium italic">Khung xem trước cấu trúc hệ thống sẽ hiển thị theo thời gian thực...</p></div>`;
        } else {
            spb.innerHTML = previewHTML;
        }
    }
}

function saveSmartQuiz() {
    const title = document.getElementById('smart-title').value.trim(); const category = document.getElementById('smart-category').value.trim() || 'Chưa phân loại';
    const timeInput = document.getElementById('smart-time').value; const isTestOnly = document.getElementById('smart-test-only').checked;
    const statusDiv = document.getElementById('smart-status');
    
    if (!title) return alert("Vui lòng nhập Tên Đề Thi.");
    if (currentSmartQuestions.length === 0) return alert("Khung văn bản trống hoặc định dạng chưa hợp lệ.");
    
    const finalTimeLimit = (timeInput && !isNaN(timeInput) && timeInput > 0) ? parseInt(timeInput) * 60 : 900;
    statusDiv.classList.remove('hidden'); statusDiv.innerText = "Đang tải dữ liệu lên hệ thống..."; statusDiv.className = "mt-4 text-center font-bold text-amber-600 text-sm";

    const newQuiz = {
        id: "QZ-SMART-" + Date.now(), title: title, category: category, timeLimit: finalTimeLimit, 
        questions: currentSmartQuestions, isTestOnly: isTestOnly, authorId: auth.currentUser ? auth.currentUser.uid : "GUEST" 
    };
    
    db.collection("quizzes").doc(newQuiz.id).set(newQuiz).then(() => {
        document.getElementById('smart-title').value = ''; document.getElementById('smart-input-area').value = ''; document.getElementById('smart-preview-box').innerHTML = ''; document.getElementById('smart-question-count').innerText = "Đã nhận diện: 0 câu";
        currentSmartQuestions = [];
        statusDiv.innerText = `Cập nhật thành công đề thi "${title}" với ${newQuiz.questions.length} câu hỏi.`;
        statusDiv.className = "mt-4 text-center font-bold text-green-600 text-sm";
        setTimeout(() => statusDiv.classList.add('hidden'), 5000);
    }).catch(err => { statusDiv.innerText = "Lỗi đường truyền: " + err; statusDiv.className = "mt-4 text-center font-bold text-red-600 text-sm"; });
}

// =========================================================================
// [VIP SAAS] ADMIN ZONE: ĐỘNG CƠ NHẬP LIỆU ĐA CẤU TRÚC (THPTQG 2025)
// =========================================================================
window.addManualQuestionForm = function(existingData = null) {
    const container = document.getElementById('manual-questions-container'); if(!container) return;
    const qDiv = document.createElement('div'); qDiv.className = 'manual-q-block p-4 sm:p-6 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl relative';

    let qType = existingData && existingData.type ? existingData.type : "mcq";
    let pass = existingData && existingData.passage ? existingData.passage : "";
    let cont = existingData && existingData.content ? existingData.content : "";
    let expl = existingData && existingData.explanation ? existingData.explanation.replace(/"/g, '&quot;') : "";

    // Phân rã dữ liệu cũ (nếu có)
    let opts = ["", "", "", ""];
    let tfAnswers = [true, false, true, false]; 
    let saAnswer = "";
    let mcqAnswer = 0;

    if (existingData) {
        if (qType === "mcq" && existingData.options) opts = existingData.options;
        if (qType === "tf" && existingData.options) {
            opts = existingData.options;
            if (existingData.correctAnswers) tfAnswers = existingData.correctAnswers;
        }
        if (qType === "sa") saAnswer = existingData.correctAnswer || "";
        if (qType === "mcq" && existingData.correctAnswer !== undefined) mcqAnswer = existingData.correctAnswer;
    }

    qDiv.innerHTML = `
        <button onclick="this.parentElement.remove()" class="absolute top-3 right-3 sm:top-4 sm:right-4 text-slate-400 hover:text-red-500 transition-colors"><i class="fas fa-times text-lg sm:text-xl"></i></button>
        <div class="flex flex-wrap items-center gap-3 mb-4">
            <h4 class="font-bold dark:text-white text-blue-600 text-sm sm:text-base"><i class="fas fa-cube mr-1"></i> Khối Câu Hỏi</h4>
            <select class="q-type-select p-2 border rounded outline-none dark:bg-slate-900 dark:text-white dark:border-slate-600 text-xs font-bold bg-white text-slate-700 shadow-sm cursor-pointer border-slate-300">
                <option value="mcq" ${qType === 'mcq' ? 'selected' : ''}>Trắc nghiệm 4 chọn 1</option>
                <option value="tf" ${qType === 'tf' ? 'selected' : ''}>Trắc nghiệm Đúng/Sai</option>
                <option value="sa" ${qType === 'sa' ? 'selected' : ''}>Trả lời ngắn (Điền từ)</option>
            </select>
        </div>
        
        <div class="mb-3 sm:mb-4">
            <textarea placeholder="Đoạn văn dùng chung (Bỏ trống nếu không có)..." class="q-passage w-full p-2 sm:p-3 border rounded outline-none focus:border-blue-500 dark:bg-slate-900 dark:text-white dark:border-slate-700 text-sm" rows="2">${pass}</textarea>
        </div>
        <textarea placeholder="Nội dung câu hỏi chính..." class="q-content w-full p-2 sm:p-3 mb-3 sm:mb-4 border rounded outline-none focus:border-blue-500 dark:bg-slate-900 dark:text-white dark:border-slate-700 text-sm font-bold shadow-inner" rows="2">${cont}</textarea>
        
        <div class="type-zone mcq-zone ${qType === 'mcq' ? '' : 'hidden'}">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                <input type="text" placeholder="Lựa chọn A" class="q-opt-mcq-0 p-2 border rounded dark:bg-slate-900 dark:text-white dark:border-slate-700 outline-none text-sm" value="${opts[0].replace(/"/g, '&quot;')}">
                <input type="text" placeholder="Lựa chọn B" class="q-opt-mcq-1 p-2 border rounded dark:bg-slate-900 dark:text-white dark:border-slate-700 outline-none text-sm" value="${opts[1].replace(/"/g, '&quot;')}">
                <input type="text" placeholder="Lựa chọn C" class="q-opt-mcq-2 p-2 border rounded dark:bg-slate-900 dark:text-white dark:border-slate-700 outline-none text-sm" value="${opts[2].replace(/"/g, '&quot;')}">
                <input type="text" placeholder="Lựa chọn D" class="q-opt-mcq-3 p-2 border rounded dark:bg-slate-900 dark:text-white dark:border-slate-700 outline-none text-sm" value="${opts[3].replace(/"/g, '&quot;')}">
            </div>
            <div class="flex items-center gap-3">
                <label class="font-bold text-sm dark:text-slate-300">Đáp án đúng:</label>
                <select class="q-correct-mcq p-1.5 border rounded outline-none dark:bg-slate-900 dark:text-white dark:border-slate-700 text-sm font-bold bg-white">
                    <option value="0" ${mcqAnswer === 0 ? 'selected' : ''}>A</option>
                    <option value="1" ${mcqAnswer === 1 ? 'selected' : ''}>B</option>
                    <option value="2" ${mcqAnswer === 2 ? 'selected' : ''}>C</option>
                    <option value="3" ${mcqAnswer === 3 ? 'selected' : ''}>D</option>
                </select>
            </div>
        </div>

        <div class="type-zone tf-zone ${qType === 'tf' ? '' : 'hidden'} bg-blue-50/50 dark:bg-slate-900/50 p-4 rounded-xl border border-blue-100 dark:border-slate-700">
            <label class="block text-xs font-bold text-blue-600 dark:text-blue-400 mb-2 uppercase tracking-wider">Nhập 4 luận điểm Đ/S:</label>
            <div class="flex flex-col gap-2 mb-2">
                ${[0,1,2,3].map(i => `
                    <div class="flex items-center gap-2">
                        <span class="font-bold w-4 text-slate-500 uppercase">${['a','b','c','d'][i]}.</span>
                        <input type="text" placeholder="Ý ${['a','b','c','d'][i]}" class="q-opt-tf-${i} flex-1 p-2 border rounded dark:bg-slate-800 dark:text-white dark:border-slate-600 outline-none text-sm" value="${opts[i].replace(/"/g, '&quot;')}">
                        <select class="q-correct-tf-${i} p-2 border rounded dark:bg-slate-800 dark:text-white dark:border-slate-600 outline-none text-sm font-bold bg-white cursor-pointer">
                            <option value="true" ${tfAnswers[i] === true ? 'selected' : ''}>Đúng</option>
                            <option value="false" ${tfAnswers[i] === false ? 'selected' : ''}>Sai</option>
                        </select>
                    </div>
                `).join('')}
            </div>
        </div>

        <div class="type-zone sa-zone ${qType === 'sa' ? '' : 'hidden'}">
            <input type="text" placeholder="Nhập đáp án chính xác (ví dụ: 15.5, Dien Bien Phu)..." class="q-correct-sa w-full p-3 border-2 border-green-300 focus:border-green-500 rounded outline-none dark:bg-slate-900 dark:text-white dark:border-green-800/50 text-sm font-bold mb-3 shadow-inner bg-green-50/30 dark:bg-green-900/10" value="${saAnswer.replace(/"/g, '&quot;')}">
            <p class="text-[10px] italic text-slate-400"><i class="fas fa-info-circle"></i> Máy chủ sẽ tự động chuẩn hóa chữ hoa/thường và bỏ khoảng trắng dư thừa khi học sinh nộp bài.</p>
        </div>

        <textarea placeholder="Giải thích chi tiết (Tùy chọn)..." class="q-expl w-full p-2 mt-4 border rounded outline-none dark:bg-slate-900 dark:text-white dark:border-slate-700 text-sm" rows="1">${expl}</textarea>
    `;

    // Lắng nghe sự kiện đổi loại câu hỏi để Render Form
    const selectType = qDiv.querySelector('.q-type-select');
    selectType.addEventListener('change', function() {
        qDiv.querySelectorAll('.type-zone').forEach(z => z.classList.add('hidden'));
        qDiv.querySelector('.' + this.value + '-zone').classList.remove('hidden');
    });

    container.appendChild(qDiv);
}

window.saveManualQuiz = function() {
    const titleEl = document.getElementById('manual-title'); const catEl = document.getElementById('manual-category'); const timeEl = document.getElementById('manual-time'); const testEl = document.getElementById('manual-test-only');
    const title = titleEl ? titleEl.value.trim() : ""; const category = catEl ? catEl.value.trim() : "";
    const manualMinutes = timeEl ? timeEl.value : ""; const timeLimit = parseInt(manualMinutes) * 60; const isTestOnly = testEl ? testEl.checked : false; 
    
    if (!title || !category || isNaN(timeLimit) || timeLimit <= 0) return alert("Vui lòng điền đủ Tên đề, Môn học và Thời gian quy định.");
    const qBlocks = document.querySelectorAll('.manual-q-block'); if (qBlocks.length === 0) return alert("Vui lòng tạo ít nhất 1 câu hỏi.");

    let questions = []; let isValid = true;
    
    qBlocks.forEach(block => {
        const qType = block.querySelector('.q-type-select').value;
        const passage = block.querySelector('.q-passage').value.trim(); 
        const content = block.querySelector('.q-content').value.trim();
        const expl = block.querySelector('.q-expl').value.trim() || "Chưa có giải thích.";
        
        if (!content) isValid = false;

        if (qType === "mcq") {
            let rawA = block.querySelector('.q-opt-mcq-0').value.trim(); let rawB = block.querySelector('.q-opt-mcq-1').value.trim(); let rawC = block.querySelector('.q-opt-mcq-2').value.trim(); let rawD = block.querySelector('.q-opt-mcq-3').value.trim();
            if (rawA === "" || rawB === "" || rawC === "" || rawD === "") isValid = false;
            const correct = parseInt(block.querySelector('.q-correct-mcq').value);
            questions.push({ type: "mcq", passage: passage, content: content, options: [rawA, rawB, rawC, rawD], correctAnswer: correct, explanation: expl });
        } 
        else if (qType === "tf") {
            let opts = []; let corrs = [];
            for(let i=0; i<4; i++) {
                let o = block.querySelector(`.q-opt-tf-${i}`).value.trim();
                if(o === "") isValid = false;
                opts.push(o);
                corrs.push(block.querySelector(`.q-correct-tf-${i}`).value === "true");
            }
            questions.push({ type: "tf", passage: passage, content: content, options: opts, correctAnswers: corrs, explanation: expl });
        }
        else if (qType === "sa") {
            let ans = block.querySelector('.q-correct-sa').value.trim();
            if(ans === "") isValid = false;
            questions.push({ type: "sa", passage: passage, content: content, correctAnswer: ans, explanation: expl });
        }
    });

    if (!isValid) return alert("Hành động bị từ chối! Bệ hạ chưa điền đủ Nội dung câu hỏi và Đáp án cho tất cả các khối.");
    
    const targetQuizId = editingQuizId ? editingQuizId : "QZ-MANUAL-" + Date.now();
    const newQuiz = { id: targetQuizId, title: title, category: category, timeLimit: timeLimit, questions: questions, isTestOnly: isTestOnly, authorId: auth.currentUser ? auth.currentUser.uid : "GUEST" };

    db.collection("quizzes").doc(newQuiz.id).set(newQuiz).then(() => {
        alert(editingQuizId ? "Cập nhật đề thi thành công!" : "Lưu đề thi mới thành công."); 
        if(titleEl) titleEl.value = ''; if(catEl) catEl.value = ''; if(timeEl) timeEl.value = ''; if(testEl) testEl.checked = false;
        const mc = document.getElementById('manual-questions-container'); if(mc) mc.innerHTML = '';
        editingQuizId = null; 
        window.history.pushState({}, '', window.location.pathname); switchScreen('home'); 
    }).catch(err => alert("Lỗi hệ thống: " + err.message));
}

function setupHighlighting() {
    document.addEventListener('mouseup', (e) => {
        const palette = document.getElementById('highlight-palette');
        if (!palette) return;
        const selection = window.getSelection();
        
        if (selection.toString().trim().length > 0 && !palette.contains(e.target)) {
            if (e.target.closest('#passage-text') || e.target.closest('#question-content')) {
                const range = selection.getRangeAt(0); const rect = range.getBoundingClientRect();
                currentSelectionRange = range.cloneRange();
                palette.style.top = `${rect.top + window.scrollY - 55}px`;
                let leftPos = rect.left + window.scrollX + (rect.width / 2) - (palette.offsetWidth / 2);
                palette.style.left = `${Math.max(10, leftPos)}px`; 
                palette.classList.remove('hidden');
            }
        } else if (!palette.contains(e.target)) { palette.classList.add('hidden'); }
    });
}

window.applyHighlight = function(colorHex) {
    if (!currentSelectionRange) return;
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(currentSelectionRange);
    
    const passageEl = document.getElementById('passage-text'); const questionEl = document.getElementById('question-content');
    if(passageEl) passageEl.contentEditable = "true"; if(questionEl) questionEl.contentEditable = "true";
    
    if (colorHex === 'transparent') { document.execCommand('backColor', false, 'rgba(0,0,0,0)'); document.execCommand('hiliteColor', false, 'rgba(0,0,0,0)'); } 
    else if (colorHex === 'underline') { document.execCommand('underline', false, null); }
    else { document.execCommand('backColor', false, colorHex); document.execCommand('hiliteColor', false, colorHex); }
    
    if(passageEl) passageEl.contentEditable = "false"; if(questionEl) questionEl.contentEditable = "false";
    if (passageEl && activeQuiz.questions[currentQuestionIndex].passage) { activeQuiz.questions[currentQuestionIndex].passage = passageEl.innerHTML; }
    if (questionEl) { activeQuiz.questions[currentQuestionIndex].content = questionEl.innerHTML; }
    
    selection.removeAllRanges(); const palette = document.getElementById('highlight-palette'); if (palette) palette.classList.add('hidden');
}

window.upgradeUserPlanByEmail = function() {
    if (!checkIsMasterAdmin()) {
        alert("Tài khoản không đủ quyền hạn thực hiện thao tác này.");
        return;
    }

    const email = document.getElementById('admin-upgrade-email').value.trim().toLowerCase();
    const newPlan = document.getElementById('admin-upgrade-plan').value;

    if (!email) return alert("Vui lòng cung cấp địa chỉ Email người dùng.");

    db.collection("users").where("email", "==", email).get().then(snapshot => {
        if (snapshot.empty) return alert("Không tìm thấy thông tin người dùng trong cơ sở dữ liệu.");
        
        snapshot.forEach(doc => {
            doc.ref.update({ plan: newPlan }).then(() => {
                alert(`Cập nhật thành công. Tài khoản ${email} đã được chuyển sang Gói ${newPlan.toUpperCase()}.`);
                document.getElementById('admin-upgrade-email').value = ""; 
            });
        });
    }).catch(err => alert("Lỗi xử lý yêu cầu: " + err.message));
}

function enterFullscreen() {
    const elem = document.documentElement;
    if (elem.requestFullscreen) { elem.requestFullscreen().catch(err => console.log(err)); }
    else if (elem.webkitRequestFullscreen) { elem.webkitRequestFullscreen(); } 
    else if (elem.msRequestFullscreen) { elem.msRequestFullscreen(); } 
}

function exitFullscreen() {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) { document.exitFullscreen(); }
        else if (document.webkitExitFullscreen) { document.webkitExitFullscreen(); }
    }
}

document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

function handleFullscreenChange() {
    if (!isPracticeMode && !isReviewMode && screens.quiz && !screens.quiz.classList.contains('hidden')) {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            showFullscreenLock();
        }
    }
}

function showFullscreenLock() {
    let lockOverlay = document.getElementById('fullscreen-lock-overlay');
    if (!lockOverlay) {
        lockOverlay = document.createElement('div');
        lockOverlay.id = 'fullscreen-lock-overlay';
        lockOverlay.className = 'fixed inset-0 bg-gray-900/95 z-[9999] flex flex-col items-center justify-center backdrop-blur-md';
        lockOverlay.innerHTML = `
            <i class="fas fa-user-shield text-red-500 text-6xl mb-6 animate-bounce"></i>
            <h2 class="font-academic text-3xl sm:text-4xl font-bold text-white mb-3 text-center">CẢNH BÁO HỆ THỐNG</h2>
            <p class="text-gray-300 mb-8 text-center max-w-lg text-sm sm:text-base px-4">
                Thao tác thoát chế độ toàn màn hình không được phép trong quá trình làm bài kiểm tra. Bài thi tạm thời bị khóa. Thời gian vẫn đang được tính.
            </p>
            <button id="btn-return-fullscreen" class="px-8 py-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-lg transition-all text-lg flex items-center gap-2">
                <i class="fas fa-expand"></i> Quay lại màn hình thi
            </button>
        `;
        document.body.appendChild(lockOverlay);
        
        document.getElementById('btn-return-fullscreen').addEventListener('click', () => {
            enterFullscreen();
            setTimeout(() => {
                if (document.fullscreenElement || document.webkitFullscreenElement) {
                    lockOverlay.classList.add('hidden');
                }
            }, 500);
        });
    }
    lockOverlay.classList.remove('hidden');
}

let subjectChartInstance = null; 

function switchSubjectTab(tab) {
    document.getElementById('subject-tab-list').classList.toggle('hidden', tab !== 'list');
    document.getElementById('subject-tab-stats').classList.toggle('hidden', tab !== 'stats');
    
    const btnList = document.getElementById('tab-btn-list');
    const btnStats = document.getElementById('tab-btn-stats');
    
    // Style mới: Viền dưới (Bottom border), màu slate/blue
    if (tab === 'list') {
        btnList.className = "pb-3 text-sm sm:text-base font-bold transition-all flex items-center gap-2 text-slate-900 dark:text-white border-b-2 border-slate-900 dark:border-white";
        btnStats.className = "pb-3 text-sm sm:text-base font-bold transition-all flex items-center gap-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 border-b-2 border-transparent";
    } else {
        btnList.className = "pb-3 text-sm sm:text-base font-bold transition-all flex items-center gap-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 border-b-2 border-transparent";
        btnStats.className = "pb-3 text-sm sm:text-base font-bold transition-all flex items-center gap-2 text-slate-900 dark:text-white border-b-2 border-slate-900 dark:border-white";
        renderSubjectStats(currentSelectedCategory);
    }
}

function renderSubjectStats() {
    if (!currentSelectedCategory) return;
    
    const safeCategory = (currentSelectedCategory || "").trim().toLowerCase();
    
    const baseQuizzes = quizDatabase.filter(q => 
        (q.category || "").trim().toLowerCase() === safeCategory && !q.isTestOnly
    );
    let totalChapters = baseQuizzes.length; 
    
    const folderQuizIds = quizDatabase.filter(q => 
        (q.category || "").trim().toLowerCase() === safeCategory
    ).map(q => q.id);

    const relevantHistory = historyDatabase.filter(h => {
        if (!h.data.quizId) return false;
        if (folderQuizIds.includes(h.data.quizId)) return true;
        if ((h.data.category || "").trim().toLowerCase() === safeCategory) return true;
        
        return false;
    });

    let totalQuizzesTaken = relevantHistory.length;
    
    if (totalQuizzesTaken === 0) {
        document.getElementById('ai-roadmap-content').innerHTML = `<div class="text-center py-6 text-gray-500"><i class="fas fa-folder-open text-3xl mb-2"></i><br>Hệ thống hiện tại chưa ghi nhận lịch sử làm bài tập theo chương.</div>`;
        document.getElementById('stat-table-body').innerHTML = `<tr><td colspan="4" class="text-center py-6 text-gray-500">Chưa có dữ liệu</td></tr>`;
        ['stat-mastery', 'stat-avg-score', 'stat-max-score'].forEach(id => document.getElementById(id).innerText = '0%');
        document.getElementById('stat-completion').innerHTML = `0/${totalChapters} <span class="text-xs text-gray-500">chương</span>`;
        document.getElementById('stat-total-quizzes').innerText = '0';
        if (subjectChartInstance) subjectChartInstance.destroy();
        return;
    }

    let chapterStats = {};
    let sumAllScores = 0;
    let absoluteMaxScore = 0;

    relevantHistory.forEach(h => {
        let title = h.data.quizTitle || "Chưa đặt tên";
        let pct = h.data.percentage || 0;
        
        if(!chapterStats[title]) chapterStats[title] = { sum: 0, count: 0, max: 0 };
        chapterStats[title].sum += pct;
        chapterStats[title].count += 1;
        if (pct > chapterStats[title].max) chapterStats[title].max = pct;
        
        sumAllScores += pct;
        if (pct > absoluteMaxScore) absoluteMaxScore = pct;
    });

    let completedChaptersCount = Object.keys(chapterStats).length;
    let globalAvgScore = Math.round(sumAllScores / totalQuizzesTaken);
    if (totalChapters < completedChaptersCount) totalChapters = completedChaptersCount; 
    let completionPercentage = totalChapters === 0 ? 100 : Math.round((completedChaptersCount / totalChapters) * 100);
    
    let masteryIndex = Math.round((globalAvgScore * 0.7) + (completionPercentage * 0.3));

    document.getElementById('stat-mastery').innerText = `${masteryIndex}%`;
    document.getElementById('stat-completion').innerHTML = `${completedChaptersCount}/${totalChapters} <span class="text-xs font-medium text-gray-500">chương</span>`;
    document.getElementById('stat-total-quizzes').innerText = totalQuizzesTaken;
    document.getElementById('stat-avg-score').innerText = `${globalAvgScore}%`;
    document.getElementById('stat-max-score').innerText = `${absoluteMaxScore}%`;

    let chartLabels = [];
    let chartData = [];
    let chartColors = [];
    let tableHTML = "";
    let processedChapters = [];

    Object.keys(chapterStats).forEach(ch => {
        let avg = Math.round(chapterStats[ch].sum / chapterStats[ch].count);
        let max = chapterStats[ch].max;
        processedChapters.push({ name: ch, avg: avg, max: max, count: chapterStats[ch].count });
    });

    processedChapters.sort((a, b) => a.name.localeCompare(b.name));

    processedChapters.forEach(ch => {
        chartLabels.push(ch.name.length > 15 ? ch.name.substring(0, 15) + '...' : ch.name);
        chartData.push(ch.avg);
        
        let color = '#ef4444'; 
        if (ch.avg >= 85) color = '#22c55e'; 
        else if (ch.avg >= 65) color = '#eab308'; 
        chartColors.push(color);

        tableHTML += `
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                <td class="p-4 font-semibold text-gray-800 dark:text-gray-200">${ch.name}</td>
                <td class="p-4 text-center text-gray-500 font-mono">${ch.count}</td>
                <td class="p-4 text-center font-bold text-blue-600 dark:text-blue-400 font-mono">${ch.avg}%</td>
                <td class="p-4 text-center font-bold text-gray-700 dark:text-gray-300 font-mono">${ch.max}%</td>
            </tr>
        `;
    });
    document.getElementById('stat-table-body').innerHTML = tableHTML;

    const lockOverlay = document.getElementById('pro-lock-overlay');
    if (!checkFeatureAccess('stats_pro', true)) {
        if (lockOverlay) lockOverlay.classList.remove('hidden');
        if (subjectChartInstance) subjectChartInstance.destroy();
        removeUltraDashboard();
        return;
    }
    
    if (lockOverlay) lockOverlay.classList.add('hidden');

    const ctx = document.getElementById('masteryChart').getContext('2d');
    if (subjectChartInstance) subjectChartInstance.destroy();
    
    const isDark = document.documentElement.classList.contains('dark');
    const textColor = isDark ? '#9ca3af' : '#4b5563';

    subjectChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: chartLabels,
            datasets: [{
                label: 'Mức độ thành thạo (%)',
                data: chartData,
                backgroundColor: chartColors,
                borderRadius: 6,
                maxBarThickness: 40
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, max: 100, ticks: { color: textColor }, grid: { color: isDark ? '#374151' : '#e5e7eb' } },
                x: { ticks: { color: textColor }, grid: { display: false } }
            }
        }
    });

    let roadmapHTML = "";
    if (completedChaptersCount < totalChapters) {
        roadmapHTML += `<div class="p-2.5 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-100 dark:border-yellow-800 rounded-xl text-yellow-800 dark:text-yellow-400 text-xs mb-2 font-medium">
            <i class="fas fa-info-circle mr-1"></i> Số chương đã học: ${completedChaptersCount}/${totalChapters}. Khuyến nghị hoàn thành các chương còn lại để số liệu chuẩn xác hơn.
        </div>`;
    }

    processedChapters.sort((a, b) => a.avg - b.avg);
    let weakest = processedChapters[0];
    
    roadmapHTML += `<p><strong class="text-indigo-900 dark:text-indigo-400"><i class="fas fa-arrow-circle-right mr-1"></i> Học phần yếu nhất:</strong> <br>Học sinh cần dành thời gian ôn tập lại chương <span class="text-red-600 dark:text-red-400 font-bold">${weakest.name}</span> (Hiệu suất đạt: ${weakest.avg}%).</p>`;
    roadmapHTML += `<p><strong class="text-indigo-900 dark:text-indigo-400"><i class="fas fa-arrow-circle-right mr-1"></i> Khuyến nghị hành động:</strong> <br>Sử dụng chức năng "Trộn Câu Sai" thuộc chương học này để khắc phục triệt để các lỗ hổng kiến thức.</p>`;
    roadmapHTML += `<p><strong class="text-indigo-900 dark:text-indigo-400"><i class="fas fa-arrow-circle-right mr-1"></i> Bước tiếp theo:</strong> <br>Sau khi nâng điểm chương này lên trên 80%, thực hiện luyện tập Mock Test tổng hợp để rèn luyện phản xạ trộn câu hỏi bẫy.</p>`;

    document.getElementById('ai-roadmap-content').innerHTML = roadmapHTML;

    if (checkFeatureAccess('stats_ultra', true)) {
        renderUltraDashboard();
    } else {
        removeUltraDashboard();
    }
}

function renderUltraDashboard() {
    let ultraSection = document.getElementById('ultra-premium-dashboard');
    if (!ultraSection) {
        ultraSection = document.createElement('div');
        ultraSection.id = 'ultra-premium-dashboard';
        ultraSection.className = 'mt-8 p-6 sm:p-8 bg-gradient-to-br from-gray-900 via-slate-800 to-black text-white rounded-3xl border border-yellow-500/40 shadow-[0_20px_50px_rgba(0,0,0,0.5)] relative overflow-hidden';
        document.getElementById('subject-tab-stats').appendChild(ultraSection);
    }

    const mockHistory = historyDatabase.filter(h => h.data.quizId && String(h.data.quizId).startsWith("MOCK-GENERATED-")).slice(0, 3).reverse();
    let mockCompareHTML = "<div class='text-gray-400 italic mt-2'>Chưa có dữ liệu Thi thử tổng hợp.</div>";
    
    if (mockHistory.length > 0) {
        mockCompareHTML = mockHistory.map((m, idx) => {
            let trendIcon = '';
            let trendColor = 'text-gray-400';
            if (idx > 0) {
                let diff = m.data.percentage - mockHistory[idx-1].data.percentage;
                if (diff > 0) { trendIcon = '<i class="fas fa-arrow-up text-green-400 text-sm ml-2"></i>'; trendColor = 'text-green-400'; }
                else if (diff < 0) { trendIcon = '<i class="fas fa-arrow-down text-red-400 text-sm ml-2"></i>'; trendColor = 'text-red-400'; }
                else { trendIcon = '<i class="fas fa-minus text-gray-400 text-sm ml-2"></i>'; }
            }
            
            return `
            <div class="flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-xl">
                <span class="text-sm text-gray-300 font-medium">Mock Test lần ${idx + 1}</span>
                <span class="font-mono font-black text-xl text-yellow-400 flex items-center">${m.data.percentage}% ${trendIcon}</span>
            </div>
        `}).join('');
    }

    let subjectAggr = {};
    historyDatabase.forEach(h => {
        let cat = h.data.category || "Chưa phân loại";
        let pct = h.data.percentage || 0;
        if (!subjectAggr[cat]) subjectAggr[cat] = { sum: 0, count: 0 };
        subjectAggr[cat].sum += pct;
        subjectAggr[cat].count += 1;
    });

    let subjectList = Object.keys(subjectAggr).map(cat => ({
        name: cat,
        avg: Math.round(subjectAggr[cat].sum / subjectAggr[cat].count)
    }));

    let strongestSub = "Chưa đủ dữ liệu", weakestSub = "Chưa đủ dữ liệu";
    let progressSpeed = "Tạm ổn";

    if (subjectList.length > 0) {
        subjectList.sort((a, b) => b.avg - a.avg);
        strongestSub = `${subjectList[0].name} <span class="bg-green-900/50 text-green-400 px-2 py-0.5 rounded text-xs ml-2">${subjectList[0].avg}%</span>`;
        weakestSub = `${subjectList[subjectList.length - 1].name} <span class="bg-red-900/50 text-red-400 px-2 py-0.5 rounded text-xs ml-2">${subjectList[subjectList.length - 1].avg}%</span>`;
        
        if (mockHistory.length >= 2) {
             let latest = mockHistory[mockHistory.length - 1].data.percentage;
             let oldest = mockHistory[0].data.percentage;
             if (latest > oldest + 10) progressSpeed = "Tiến bộ Thần Tốc <i class='fas fa-rocket text-yellow-400 ml-1'></i>";
             else if (latest > oldest) progressSpeed = "Đang Cải Thiện <i class='fas fa-arrow-trend-up text-green-400 ml-1'></i>";
             else progressSpeed = "Phong Độ Đi Xuống <i class='fas fa-arrow-trend-down text-red-400 ml-1'></i>";
        } else {
             progressSpeed = "Cần làm thêm Mock Test";
        }
    }

    ultraSection.innerHTML = `
        <div class="absolute top-[-20%] right-[-10%] opacity-10 text-[10rem] pointer-events-none transform rotate-12 transition-transform duration-1000 hover:rotate-45"><i class="fas fa-gem text-yellow-400"></i></div>
        <div class="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPgo8cmVjdCB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSIjZmZmIiBmaWxsLW9wYWNpdHk9IjAuMDUiLz4KPHBhdGggZD0iTTAgMGw4IDhaTTAgOGw4IC04WiIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9IjEiIHN0cm9rZS1vcGFjaXR5PSIwLjEiLz4KPC9zdmc+')] opacity-20 pointer-events-none"></div>

        <h3 class="text-2xl sm:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 to-yellow-600 mb-8 flex items-center gap-3 font-academic drop-shadow-lg relative z-10">
            <i class="fas fa-radar text-yellow-400"></i> Đài Quan Sát Năng Lực Toàn Kho
        </h3>
        
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 relative z-10">
            <div class="p-6 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 hover:border-yellow-500/50 transition-colors">
                <h4 class="text-xs font-black uppercase tracking-[0.2em] text-gray-400 mb-4 flex items-center"><i class="fas fa-history mr-2 text-yellow-400"></i>Phong độ Thi Thử (Mock Test)</h4>
                <div class="space-y-3">
                    ${mockCompareHTML}
                </div>
            </div>
            
            <div class="p-6 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 flex flex-col justify-between hover:border-yellow-500/50 transition-colors">
                <div>
                    <h4 class="text-xs font-black uppercase tracking-[0.2em] text-gray-400 mb-5 flex items-center"><i class="fas fa-globe mr-2 text-blue-400"></i>Báo Cáo Chiến Lược Liên Môn</h4>
                    <div class="space-y-4 text-sm sm:text-base">
                        <div class="flex flex-col sm:flex-row sm:items-center justify-between bg-black/30 p-3 rounded-lg">
                            <span class="text-gray-400 font-medium mb-1 sm:mb-0"><i class="fas fa-shield-alt w-5 text-center text-blue-400"></i> Phòng ngự tốt nhất:</span>
                            <span class="font-bold tracking-wide">${strongestSub}</span>
                        </div>
                        <div class="flex flex-col sm:flex-row sm:items-center justify-between bg-black/30 p-3 rounded-lg">
                            <span class="text-gray-400 font-medium mb-1 sm:mb-0"><i class="fas fa-exclamation-circle w-5 text-center text-red-400"></i> Lỗ hổng chí mạng:</span>
                            <span class="font-bold tracking-wide">${weakestSub}</span>
                        </div>
                        <div class="flex flex-col sm:flex-row sm:items-center justify-between bg-black/30 p-3 rounded-lg">
                            <span class="text-gray-400 font-medium mb-1 sm:mb-0"><i class="fas fa-tachometer-alt w-5 text-center text-yellow-400"></i> Tốc độ thăng tiến:</span>
                            <span class="font-bold tracking-wide text-yellow-400">${progressSpeed}</span>
                        </div>
                    </div>
                </div>
                <p class="text-[0.65rem] text-gray-500 italic mt-6 border-t border-white/5 pt-3 uppercase tracking-wider">* Số liệu được AI tổng hợp tự động từ toàn bộ lịch sử làm đề của bạn.</p>
            </div>
        </div>
    `;
}

function removeUltraDashboard() {
    const container = document.getElementById('ultra-premium-container');
    if (container) container.innerHTML = '';
}

const originalRenderSubjectDetailView = renderSubjectDetailView;
renderSubjectDetailView = function(category) {
    const cInput = document.getElementById('search-chapter-input');
    
    if (cInput && document.activeElement !== cInput) {
        cInput.value = "";
        originalRenderSubjectDetailView(category);
        switchSubjectTab('list');
    } else {
        originalRenderSubjectDetailView(category);
    }
}

function updatePlanBadge() {
    let homeBadge = document.getElementById('home-plan-badge');
    const quizBadge = document.getElementById('quiz-plan-badge');
    const statsBadge = document.getElementById('dynamic-stats-badge'); 
    
    let badgeHTML = '';
    let statsBadgeHTML = '';
    
    const planToUse = (currentPlan || 'basic').toLowerCase();
    
    switch(planToUse) {
        case 'plus':
            badgeHTML = `<span class="badge-pill badge-bronze" title="Gói Plus"><i class="fas fa-medal mr-1.5"></i> Plus</span>`;
            statsBadgeHTML = `<span class="ml-1 badge-pill badge-bronze text-[0.6rem] px-1.5 py-0.5"><i class="fas fa-medal"></i> Plus</span>`;
            break;
        case 'pro':
            badgeHTML = `<span class="badge-pill badge-silver" title="Gói Pro"><i class="fas fa-shield-alt mr-1.5"></i> Pro</span>`;
            statsBadgeHTML = `<span class="ml-1 badge-pill badge-silver text-[0.6rem] px-1.5 py-0.5"><i class="fas fa-shield-alt"></i> Pro</span>`;
            break;
        case 'ultra':
            badgeHTML = `<span class="badge-pill badge-gold" title="Gói Ultra"><i class="fas fa-crown mr-1.5"></i> Ultra</span>`;
            statsBadgeHTML = `<span class="ml-1 badge-pill badge-gold text-[0.6rem] px-1.5 py-0.5"><i class="fas fa-crown"></i> Ultra</span>`;
            break;
        default:
            badgeHTML = `<span class="badge-pill badge-basic" title="Gói Cơ Bản"><i class="fas fa-user mr-1.5"></i> Cơ bản</span>`;
            statsBadgeHTML = `<span class="ml-1 badge-pill badge-basic text-[0.6rem] px-1.5 py-0.5"><i class="fas fa-lock"></i> Khóa</span>`;
    }

    if (!homeBadge) {
        const logoutBtn = document.getElementById('btn-logout');
        if (logoutBtn && logoutBtn.parentElement) {
            homeBadge = document.createElement('div');
            homeBadge.id = 'home-plan-badge';
            homeBadge.className = 'shrink-0';
            logoutBtn.parentElement.appendChild(homeBadge);
        }
    }

    if (homeBadge) homeBadge.innerHTML = badgeHTML;
    if (quizBadge) quizBadge.innerHTML = badgeHTML;
    if (statsBadge) statsBadge.innerHTML = statsBadgeHTML;
}

setTimeout(updatePlanBadge, 500);

window.editQuiz = function(quizId) {
    const quiz = quizDatabase.find(q => q.id === quizId);
    if (!quiz) return showToast("Không tìm thấy đề thi.", true);
    
    editingQuizId = quizId; 
    
    switchScreen('admin');
    switchAdminTab('manual');
    
    document.getElementById('manual-title').value = quiz.title || "";
    document.getElementById('manual-category').value = quiz.category || "";
    document.getElementById('manual-time').value = Math.floor((quiz.timeLimit || 900) / 60);
    const testEl = document.getElementById('manual-test-only');
    if (testEl) testEl.checked = quiz.isTestOnly || false;
    
    const container = document.getElementById('manual-questions-container');
    if(container) container.innerHTML = '';
    
    if (quiz.questions && Array.isArray(quiz.questions)) {
        quiz.questions.forEach(q => { addManualQuestionForm(q); });
    }
    
    showToast("Đã nạp dữ liệu đề thi. Bệ hạ có thể bắt đầu chỉnh sửa.", false);
};

// [VIP] Lõi định vị câu hỏi theo bộ lọc (Đúng/Sai/Chưa làm...)
function getFilteredIndex(step) {
    let nextIdx = currentQuestionIndex + step;
    while (nextIdx >= 0 && nextIdx < activeQuiz.questions.length) {
        let isDone = userAnswers[nextIdx] !== null; 
        let isFlagged = flaggedQuestions[nextIdx];
        let isCorrect = isDone && userAnswers[nextIdx] === activeQuiz.questions[nextIdx].correctAnswer;
        let isWrong = isDone && userAnswers[nextIdx] !== activeQuiz.questions[nextIdx].correctAnswer;

        if (currentFilter === 'all') return nextIdx;
        if (currentFilter === 'pending' && !isDone) return nextIdx;
        if (currentFilter === 'done' && isDone) return nextIdx;
        if (currentFilter === 'flagged' && isFlagged) return nextIdx;
        if (currentFilter === 'correct' && isCorrect) return nextIdx;
        if (currentFilter === 'wrong' && isWrong) return nextIdx;

        nextIdx += step;
    }
    return -1; // Báo hiệu đã hết câu thỏa mãn
}

// [VIP SAAS] XỬ LÝ HỒ SƠ NĂNG LỰC & BIỂU ĐỒ RADAR (HÀM MỚI BỔ SUNG)
function renderSubjectStats(category) {
    if (!category) return;
    
    let quizzesInFolder = quizDatabase.filter(q => q.category === category);
    let historyInFolder = historyDatabase.filter(h => h.data.category === category);
    
    let totalQuizzes = quizzesInFolder.length;
    let attemptedQuizzes = [...new Set(historyInFolder.map(h => h.data.quizId))];
    let completedCount = attemptedQuizzes.length;
    
    let completionRate = totalQuizzes === 0 ? 0 : Math.round((completedCount / totalQuizzes) * 100);
    
    let avgScore = 0;
    let maxScore = 0;
    let mastery = 0;

    if (historyInFolder.length > 0) {
        let totalPercentages = historyInFolder.reduce((sum, h) => sum + (h.data.percentage || 0), 0);
        avgScore = Math.round(totalPercentages / historyInFolder.length);
        maxScore = Math.max(...historyInFolder.map(h => h.data.percentage || 0));
        mastery = Math.round((completionRate * 0.4) + (avgScore * 0.6));
    }

    // Đồng bộ chính xác với 4 thẻ kiến trúc HTML mới
    const elMastery = document.getElementById('stat-mastery'); if(elMastery) elMastery.innerText = mastery + '%';
    const elCompletion = document.getElementById('stat-completion'); if(elCompletion) elCompletion.innerHTML = `${completedCount}/${totalQuizzes} <span class="text-xs font-medium text-slate-400 ml-1">chương</span>`;
    const elAvg = document.getElementById('stat-avg-score'); if(elAvg) elAvg.innerText = avgScore + '%';
    const elMax = document.getElementById('stat-max-score'); if(elMax) elMax.innerText = maxScore + '%';

    // Nhóm dữ liệu để vẽ bảng và biểu đồ
    let grouped = {};
    let labels = [];
    let dataPoints = [];

    historyInFolder.forEach(h => {
        let qId = h.data.quizId;
        if(!grouped[qId]) grouped[qId] = { title: h.data.quizTitle, attempts: 0, sumPct: 0, maxPct: 0 };
        grouped[qId].attempts++;
        grouped[qId].sumPct += (h.data.percentage || 0);
        if((h.data.percentage || 0) > grouped[qId].maxPct) grouped[qId].maxPct = (h.data.percentage || 0);
    });

    const tbody = document.getElementById('stat-table-body');
    if (tbody) {
        tbody.innerHTML = '';
        if (Object.keys(grouped).length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-slate-400 font-medium">Chưa có dữ liệu làm bài. Hãy hoàn thành ít nhất 1 bài thi để hệ thống phân tích.</td></tr>';
        } else {
            Object.values(grouped).forEach(g => {
                let avg = Math.round(g.sumPct / g.attempts);
                
                // Thu thập dữ liệu Chart (Cắt gọn tên nếu quá dài để Radar không bị méo)
                let shortTitle = g.title.length > 18 ? g.title.substring(0, 18) + '...' : g.title;
                labels.push(shortTitle);
                dataPoints.push(g.maxPct);

                let tr = document.createElement('tr');
                tr.className = 'hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors border-b border-slate-100 dark:border-slate-700/60 last:border-0';
                tr.innerHTML = `
                    <td class="p-5 font-bold text-slate-800 dark:text-slate-200 truncate max-w-[200px]" title="${g.title}">${g.title}</td>
                    <td class="p-5 text-center text-slate-500 dark:text-slate-400 font-mono font-semibold">${g.attempts}</td>
                    <td class="p-5 text-center font-bold ${avg >= 50 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}">${avg}%</td>
                    <td class="p-5 text-center font-extrabold text-blue-600 dark:text-blue-400">${g.maxPct}%</td>
                `;
                tbody.appendChild(tr);
            });
        }
    }

    // VẼ BIỂU ĐỒ RADAR HỒ SƠ NĂNG LỰC
    const ctx = document.getElementById('masteryChart');
    if (ctx) {
        if (window.masteryChartInstance) {
            window.masteryChartInstance.destroy();
        }

        // Radar chart cần ít nhất 3 điểm để thành hình đa giác. Nếu ít hơn, tạo trục ảo để giữ form đẹp.
        if (labels.length > 0 && labels.length < 3) {
            labels.push('Phản xạ', 'Ghi nhớ');
            dataPoints.push(avgScore, maxScore);
        }

        const isDark = document.documentElement.classList.contains('dark');
        const textColor = isDark ? '#94a3b8' : '#64748b'; 
        const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';

        window.masteryChartInstance = new Chart(ctx, {
            type: 'radar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Đỉnh điểm năng lực (%)',
                    data: dataPoints,
                    backgroundColor: 'rgba(37, 99, 235, 0.2)', // Nền xanh mờ cao cấp
                    borderColor: '#2563eb',
                    pointBackgroundColor: '#ffffff',
                    pointBorderColor: '#2563eb',
                    pointHoverBackgroundColor: '#2563eb',
                    pointHoverBorderColor: '#ffffff',
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    borderWidth: 2,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    r: {
                        angleLines: { color: gridColor },
                        grid: { color: gridColor },
                        pointLabels: {
                            color: textColor,
                            font: { family: "'Plus Jakarta Sans', sans-serif", size: 11, weight: 'bold' }
                        },
                        ticks: { display: false, min: 0, max: 100 } // Ẩn số trục để đồ thị sạch sẽ
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: isDark ? '#1e293b' : '#ffffff',
                        titleColor: isDark ? '#ffffff' : '#0f172a',
                        bodyColor: isDark ? '#cbd5e1' : '#475569',
                        borderColor: isDark ? '#334155' : '#e2e8f0',
                        borderWidth: 1,
                        padding: 12,
                        boxPadding: 6,
                        usePointStyle: true,
                        titleFont: { family: "'Plus Jakarta Sans', sans-serif", size: 13 },
                        bodyFont: { family: "'Plus Jakarta Sans', sans-serif", size: 12, weight: 'bold' }
                    }
                }
            }
        });
    }

    // AI TƯ VẤN LỘ TRÌNH THÔNG MINH
    const aiBox = document.getElementById('ai-roadmap-content');
    if (aiBox) {
        let aiHTML = '';
        if (historyInFolder.length === 0) {
            aiHTML = '<p class="flex items-start gap-3"><i class="fas fa-info-circle text-blue-500 mt-1 text-lg"></i> <span>Hệ thống chưa đủ dữ liệu. Xin học viên làm thử 1 đề để AI thiết lập ma trận phân tích.</span></p>';
        } else if (mastery >= 80) {
            aiHTML = `
                <p class="flex items-start gap-3"><i class="fas fa-check-circle text-green-500 mt-1 text-lg"></i> <span><strong>Thành tích xuất sắc:</strong> Nền tảng kiến thức cốt lõi của khóa học này đã vững vàng.</span></p>
                <p class="flex items-start gap-3"><i class="fas fa-arrow-circle-up text-blue-500 mt-1 text-lg"></i> <span><strong>Khuyến nghị:</strong> Tiến hành <strong class="text-slate-800 dark:text-white">Thi thử tổng hợp (Mock Test)</strong> để làm quen áp lực thời gian.</span></p>
            `;
        } else if (mastery >= 50) {
            aiHTML = `
                <p class="flex items-start gap-3"><i class="fas fa-exclamation-circle text-amber-500 mt-1 text-lg"></i> <span><strong>Đánh giá:</strong> Năng lực duy trì ở mức khá, nhưng phong độ còn nhiều điểm mù.</span></p>
                <p class="flex items-start gap-3"><i class="fas fa-tools text-amber-600 mt-1 text-lg"></i> <span><strong>Khuyến nghị:</strong> Ưu tiên khởi chạy <strong class="text-slate-800 dark:text-white">Trộn Câu Sai</strong> để rà soát và lấp lỗ hổng tri thức.</span></p>
            `;
        } else {
            aiHTML = `
                <p class="flex items-start gap-3"><i class="fas fa-exclamation-triangle text-red-500 mt-1 text-lg"></i> <span><strong>Báo động đỏ:</strong> Ma trận kiến thức đang xuất hiện nhiều rạn nứt nghiêm trọng.</span></p>
                <p class="flex items-start gap-3"><i class="fas fa-book-reader text-blue-500 mt-1 text-lg"></i> <span><strong>Lộ trình:</strong> Tạm ngưng làm bài mới. Vui lòng đọc kỹ <strong class="text-slate-800 dark:text-white">Giải thích chi tiết</strong> ở các đề cũ.</span></p>
            `;
        }
        aiBox.innerHTML = aiHTML;
    }
}

// [VIP SAAS] TÍNH NĂNG ĐĂNG NHẬP GOOGLE BỌC THÉP (CHUYỂN GIAO DIỆN TRỰC TIẾP KHÔNG RELOAD)
function loginWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    auth.signInWithPopup(provider)
        .then((result) => {
            const user = result.user;
            
            // Bắn thông báo thành công màu xanh lá
            const toastEl = document.getElementById('system-toast');
            const toastMsg = document.getElementById('system-toast-msg');
            if (toastEl && toastMsg) {
                toastEl.classList.remove('bg-red-600');
                toastEl.classList.add('bg-green-600'); // Đổi màu Toast sang Xanh Success
                const icon = toastEl.querySelector('i');
                if(icon) icon.className = 'fas fa-check-circle text-base';
                toastMsg.innerText = "Xác thực Google thành công! Đang vào hệ thống...";
                toastEl.classList.remove('opacity-0', 'pointer-events-none');
                setTimeout(() => toastEl.classList.add('opacity-0', 'pointer-events-none'), 3000);
            }

            // Kiểm tra và khởi tạo dữ liệu Firestore nếu là người mới
            db.collection("users").doc(user.uid).get().then((docSnap) => {
                if (!docSnap.exists) {
                    db.collection("users").doc(user.uid).set({
                        name: user.displayName || "Học viên",
                        role: "student", 
                        pinnedFolders: [],
                        plan: "basic" 
                    }).then(() => {
                        // Gọi hàm chuyển màn hình trực tiếp
                        if(typeof switchScreen === 'function') switchScreen('home'); 
                    });
                } else {
                    // Đã có data, chuyển màn hình trực tiếp
                    if(typeof switchScreen === 'function') switchScreen('home'); 
                }
            });
        })
        .catch((error) => {
            console.error("Lỗi đăng nhập Google:", error);
            
            // Bắn thông báo lỗi màu đỏ
            const toastEl = document.getElementById('system-toast');
            const toastMsg = document.getElementById('system-toast-msg');
            if (toastEl && toastMsg) {
                toastEl.classList.remove('bg-green-600');
                toastEl.classList.add('bg-red-600');
                const icon = toastEl.querySelector('i');
                if(icon) icon.className = 'fas fa-exclamation-triangle text-base';
                toastMsg.innerText = "Đăng nhập thất bại: " + error.message;
                toastEl.classList.remove('opacity-0', 'pointer-events-none');
                setTimeout(() => toastEl.classList.add('opacity-0', 'pointer-events-none'), 4000);
            }
        });
}

// =========================================================================
// [VIP SAAS] TRẬN PHÁP CHỐNG GIAN LẬN: CẢNH BÁO CHUYỂN TAB / ĐỔI CỬA SỔ
// =========================================================================
let cheatViolationCount = 0;

document.addEventListener("visibilitychange", () => {
    // [VÁ LỖI TỬ HUYỆT] Chế độ Luyện Tập hoặc Xem Lại Bài sẽ được MIỄN TỬ KIM BÀI!
    if (isPracticeMode || isReviewMode) return;

    const quizScreen = document.getElementById("quiz-screen");
    if (quizScreen && !quizScreen.classList.contains("hidden")) {
        if (document.visibilityState === "hidden") {
            cheatViolationCount++;
            
            if (cheatViolationCount === 1) {
                alert("CẢNH BÁO VI PHẠM (1/2): Hệ thống phát hiện ngài vừa chuyển đổi cửa sổ/Tab trình duyệt!\n\nChiếu theo quy chế, nếu tái phạm lần 2, hệ thống sẽ tự động khóa và nộp bài thi ngay lập tức.");
            } 
            else if (cheatViolationCount >= 2) {
                alert("ĐÌNH CHỈ THI (2/2): Đã vi phạm quy chế lần 2!\n\nHệ thống đang tiến hành khóa dữ liệu và tự động nộp bài...");
                const btnSubmit = document.getElementById("btn-submit");
                if (btnSubmit) btnSubmit.click();
            }
        }
    }
});

window.resetAntiCheat = function() {
    cheatViolationCount = 0;
}

// =========================================================================
// [VIP SAAS] TẦNG QUẢN TRỊ THƯ VIỆN CỘNG ĐỒNG (COMMUNITY LIBRARY)
// =========================================================================

// Hàm 1: Kiểm tra trạng thái Public của Thư mục hiện tại
function checkFolderPublishStatus(category) {
    const container = document.getElementById('publish-folder-container');
    const toggleBtn = document.getElementById('toggle-publish-folder');
    const statusText = document.getElementById('publish-status-text');
    
    if (!container) return;

    // Chỉ Tác giả gốc mới được quyền thấy và gạt nút này
    if (currentRole === 'teacher' && !isSharedMode) {
        container.classList.remove('hidden');
        container.classList.add('flex');
        
        // Truy vấn mỏng lên Firestore để xem trạng thái
        const folderId = `${auth.currentUser.uid}_${category}`.replace(/\s+/g, '_'); // Tạo ID chống trùng lặp
        
        db.collection("community_folders").doc(folderId).get().then(doc => {
            if (doc.exists && doc.data().isPublic) {
                toggleBtn.checked = true;
                statusText.innerText = "Đã xuất bản (Công khai)";
                statusText.className = "text-[10px] font-bold text-blue-600 dark:text-blue-400";
            } else {
                toggleBtn.checked = false;
                statusText.innerText = "Đang ẩn (Chỉ mình tôi)";
                statusText.className = "text-[10px] font-medium text-slate-400";
            }
        }).catch(err => console.error("Lỗi đồng bộ danh bạ cộng đồng: ", err));
    } else {
        // Nếu là học sinh đang xem, giấu cái nút này đi
        container.classList.add('hidden');
        container.classList.remove('flex');
    }
}

// Hàm 2: Xử lý khi Bệ hạ click gạt nút On/Off
window.toggleFolderVisibility = function(isPublic) {
    if (!currentSelectedCategory) return;
    
    const statusText = document.getElementById('publish-status-text');
    const folderId = `${auth.currentUser.uid}_${currentSelectedCategory}`.replace(/\s+/g, '_');
    
    if (isPublic) {
        statusText.innerText = "Đang đồng bộ...";
        
        const folderData = {
            id: folderId,
            authorId: auth.currentUser.uid,
            authorName: auth.currentUser.displayName || "Giảng viên",
            category: currentSelectedCategory,
            isPublic: true,
            completionCount: firebase.firestore.FieldValue.increment(0), // Chuẩn bị sẵn biến đếm lượt làm
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        db.collection("community_folders").doc(folderId).set(folderData, { merge: true }).then(() => {
            showToast(`Đã xuất bản môn "${currentSelectedCategory}" lên Thư Viện Cộng Đồng!`, false);
            statusText.innerText = "Đã xuất bản (Công khai)";
            statusText.className = "text-[10px] font-bold text-blue-600 dark:text-blue-400";
        }).catch(err => {
            showToast("Lỗi xuất bản: " + err.message, true);
            document.getElementById('toggle-publish-folder').checked = false;
        });
        
    } else {
        statusText.innerText = "Đang gỡ xuống...";
        
        db.collection("community_folders").doc(folderId).update({
            isPublic: false,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => {
            showToast(`Đã gỡ môn "${currentSelectedCategory}" khỏi Thư Viện Cộng Đồng!`, false);
            statusText.innerText = "Đang ẩn (Chỉ mình tôi)";
            statusText.className = "text-[10px] font-medium text-slate-400";
        }).catch(err => {
            showToast("Lỗi thu hồi: " + err.message, true);
            document.getElementById('toggle-publish-folder').checked = true;
        });
    }
}

// [VIP SAAS] HIỂN THỊ CHỢ THƯ VIỆN CỘNG ĐỒNG
window.fetchAndRenderCommunity = function() {
    const container = document.getElementById('quiz-list-container');
    const searchEl = document.getElementById('search-folder-input');
    const keyword = searchEl ? searchEl.value.trim().toLowerCase() : "";
    
    container.innerHTML = '<div class="col-span-full flex justify-center py-16"><i class="fas fa-circle-notch fa-spin text-blue-500 text-4xl"></i></div>';
    
    // Truy vấn dữ liệu: Lấy Folder Public, xếp hạng theo Lượt Test giảm dần
    let query = db.collection("community_folders").where("isPublic", "==", true).orderBy("completionCount", "desc").limit(50);
    
    query.get().then(snapshot => {
        container.innerHTML = '';
        if (snapshot.empty) {
            container.innerHTML = '<div class="col-span-full text-center py-16 text-slate-400"><i class="fas fa-wind text-5xl mb-4 opacity-20"></i><p class="font-medium">Thư viện hiện tại chưa có giáo trình nào được xuất bản.</p></div>';
            return;
        }
        
        let folders = [];
        snapshot.forEach(doc => folders.push(doc.data()));
        
        // Lọc theo từ khóa tìm kiếm (nếu có)
        if (keyword) {
            folders = folders.filter(f => f.category.toLowerCase().includes(keyword) || f.authorName.toLowerCase().includes(keyword));
        }
        
        if (folders.length === 0) {
            container.innerHTML = '<p class="col-span-full text-center py-12 text-slate-400 font-medium">Không tìm thấy giáo trình phù hợp.</p>';
            return;
        }
        
        folders.forEach(folder => {
            const card = document.createElement('div');
            card.className = 'relative p-5 sm:p-6 bg-white dark:bg-[#1E293B] border border-slate-200/60 dark:border-slate-700/60 rounded-[24px] hover:-translate-y-1.5 hover:shadow-[0_15px_40px_-10px_rgba(37,99,235,0.15)] hover:border-blue-300 dark:hover:border-blue-800 transition-all duration-300 cursor-pointer group flex flex-col justify-between min-h-[140px] overflow-hidden';
            
            card.innerHTML = `
                <div class="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-blue-500/10 to-transparent rounded-bl-full pointer-events-none transition-all duration-500 group-hover:scale-125"></div>
                <div class="flex items-start w-full min-w-0 mb-4 z-10 relative">
                    <div class="w-12 h-12 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-800 dark:to-slate-800 text-blue-600 dark:text-blue-400 rounded-[14px] flex items-center justify-center text-xl shadow-sm border border-blue-100/50 dark:border-slate-700 shrink-0 mr-4 group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300">
                        <i class="fas fa-globe-asia"></i>
                    </div>
                    <div class="flex-1 min-w-0 pt-0.5">
                        <h3 class="text-lg font-extrabold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors leading-tight tracking-tight line-clamp-2" title="${folder.category}">${folder.category}</h3>
                        <p class="text-[11px] text-slate-400 mt-2 font-bold uppercase tracking-wider"><i class="fas fa-user-edit mr-1 opacity-70"></i> ${folder.authorName}</p>
                    </div>
                </div>
                <div class="mt-auto pt-4 border-t border-slate-100 dark:border-slate-700/50 flex items-center justify-between z-10 relative">
                    <span class="text-[10px] font-extrabold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-1.5 rounded-lg border border-emerald-100 dark:border-emerald-800/30 shadow-inner flex items-center gap-1.5">
                        <i class="fas fa-fire text-orange-500"></i>${folder.completionCount || 0} Lượt
                    </span>
                    <span class="text-xs font-bold text-blue-500 opacity-0 group-hover:opacity-100 transition-all transform group-hover:translate-x-0 -translate-x-2">Truy cập <i class="fas fa-arrow-right ml-1"></i></span>
                </div>
            `;
            
            // Cơ chế Reference: Bấm vào là nạp thẳng đề gốc của tác giả lên học tạm
            card.onclick = () => {
                loadSharedFolder(folder.category, folder.authorId);
            };
            container.appendChild(card);
        });
    }).catch(err => {
        container.innerHTML = `<p class="col-span-full text-center text-red-500 py-12 font-bold"><i class="fas fa-exclamation-triangle mr-2"></i>Lỗi kết nối Thư viện: ${err.message}</p>`;
    });
}
