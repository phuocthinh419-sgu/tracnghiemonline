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

let currentPlan = 'basic';
let mockGeneratedThisMonth = 0;
let lastMockMonth = null;
let isSharedMode = false; 
let lastPinnedStr = ""; 
let teacherQuizListener = null;
let studentQuizListener = null; 

// --- 3. THEO DÕI TRẠNG THÁI & KHỞI TẠO AN TOÀN ---
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

    setupEventListeners(); 
    setupHighlighting(); 
    
    auth.onAuthStateChanged((user) => {
        if (user) {
            if (user.displayName) {
                const nameEl = document.getElementById('student-name');
                if(nameEl) nameEl.value = user.displayName;
            }
            setRole('student');
            
            fetchQuizzesFromFirebase(); 
            fetchHistoryFromFirebase(); 

            db.collection("users").doc(user.uid).onSnapshot(doc => {
                if(doc.exists) {
                    currentPlan = doc.data().plan || 'basic';
                    if (checkIsMasterAdmin()) currentPlan = 'ultra';
                    
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

            const urlParams = new URLSearchParams(window.location.search);
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

function fetchQuizzesFromFirebase() {
    if (!auth.currentUser) return;
    
    if (teacherQuizListener) { teacherQuizListener(); teacherQuizListener = null; }
    if (studentQuizListener) { studentQuizListener(); studentQuizListener = null; }

    if (currentRole === 'teacher') {
        teacherQuizListener = db.collection("quizzes")
          .where("authorId", "==", auth.currentUser.uid)
          .onSnapshot((snapshot) => {
            if (isSharedMode) return; 
            quizDatabase = [];
            snapshot.forEach((doc) => { quizDatabase.push(doc.data()); });
            isQuizzesLoaded = true; 
            
            if (screens.home && !screens.home.classList.contains('hidden')) {
                if (currentRole === 'teacher' || currentStudentTab === 'browse') renderHomeQuizList(); 
            }
            if (screens.subjectDetail && !screens.subjectDetail.classList.contains('hidden')) {
                renderSubjectDetailView(currentSelectedCategory);
            }
        }, (error) => { console.error("Lỗi tải dữ liệu Giáo viên: ", error); });
    } else {
        fetchStudentPinnedQuizzes(); 
    }
}

function fetchStudentPinnedQuizzes() {
    if (currentRole !== 'student' || isSharedMode) return;
    
    if (pinnedFolders.length === 0) {
        quizDatabase = [];
        isQuizzesLoaded = true;
        if (screens.home && !screens.home.classList.contains('hidden')) renderHomeQuizList();
        return;
    }
    
    const teacherIds = [...new Set(pinnedFolders.map(f => f.teacherId))];
    
    if (studentQuizListener) { studentQuizListener(); studentQuizListener = null; }
    
    studentQuizListener = db.collection("quizzes")
        .where("authorId", "in", teacherIds)
        .onSnapshot((snapshot) => {
            let tempQuizzes = [];
            snapshot.forEach(doc => { tempQuizzes.push(doc.data()); });
            
            quizDatabase = tempQuizzes.filter(quiz => 
                pinnedFolders.some(f => f.teacherId === quiz.authorId && f.category === quiz.category)
            );
            
            isQuizzesLoaded = true;
            
            if (screens.home && !screens.home.classList.contains('hidden') && currentStudentTab === 'browse') {
                renderHomeQuizList();
            }
            if (screens.subjectDetail && !screens.subjectDetail.classList.contains('hidden')) {
                renderSubjectDetailView(currentSelectedCategory);
            }
        }, (error) => {
            console.error("Lỗi dòng truyền siêu tốc Học sinh: ", error);
            isQuizzesLoaded = true;
            if (screens.home && !screens.home.classList.contains('hidden')) renderHomeQuizList();
        });
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
    db.collection("quizzes").doc(quizId).get().then((doc) => {
        if (doc.exists) {
            activeQuiz = doc.data(); prepareWelcomeScreen();
        } else {
            showToast("Đề thi này không tồn tại hoặc đã bị gỡ bỏ khỏi hệ thống.", true); switchScreen('home');
        }
        window.history.replaceState({}, document.title, window.location.pathname);
    }).catch(err => { console.error("Lỗi đường dẫn: ", err); switchScreen('home'); });
}

function loadSharedFolder(category, teacherId) {
    showToast("Đang tải dữ liệu môn học...", false);
    isSharedMode = true; 
    
    db.collection("quizzes")
      .where("authorId", "==", teacherId)
      .get().then(snapshot => {
          quizDatabase = []; 
          snapshot.forEach(doc => { 
              if (doc.data().category === category) {
                  quizDatabase.push(doc.data()); 
              }
          });
          
          if(quizDatabase.length === 0) {
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
    addEvt('btn-prev', 'click', () => loadQuestion(currentQuestionIndex - 1));
    addEvt('btn-next', 'click', () => loadQuestion(currentQuestionIndex + 1));
    
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

function switchStudentTab(tabName) {
    currentStudentTab = tabName;
    const btnBrowse = document.getElementById('btn-tab-browse'); const btnHistory = document.getElementById('btn-tab-history');
    if (btnBrowse && btnHistory) {
        if (tabName === 'browse') {
            btnBrowse.className = 'px-4 py-2 font-bold rounded-lg bg-blue-900 text-white text-xs sm:text-sm shadow-md';
            btnHistory.className = 'px-4 py-2 font-bold rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 text-xs sm:text-sm';
        } else {
            btnHistory.className = 'px-4 py-2 font-bold rounded-lg bg-blue-900 text-white text-xs sm:text-sm shadow-md';
            btnBrowse.className = 'px-4 py-2 font-bold rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 text-xs sm:text-sm';
        }
    }
    renderHomeQuizList();
}

function toggleDarkMode() {
    document.documentElement.classList.toggle('dark');
    const icon = document.getElementById('theme-icon');
    if(icon) icon.className = document.documentElement.classList.contains('dark') ? 'fas fa-sun text-lg sm:text-xl' : 'fas fa-moon text-lg sm:text-xl';
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

function renderHomeQuizList() {
    const container = document.getElementById('quiz-list-container');
    if(!container) return;
    container.innerHTML = '';
    
    const searchEl = document.getElementById('search-folder-input');
    const keyword = searchEl ? searchEl.value.trim().toLowerCase() : "";
    
    if (currentRole === 'teacher' || currentStudentTab === 'browse') {
        if (!isQuizzesLoaded) {
            container.innerHTML = '<p class="col-span-full text-center text-gray-500 py-8 animate-pulse">Đang tải kho môn học...</p>';
            return;
        }

        let categories = [...new Set(quizDatabase.map(q => q.category))];
        
        if (keyword) {
            categories = categories.filter(cat => cat.toLowerCase().includes(keyword));
        }

        if (categories.length === 0) {
            container.innerHTML = '<p class="col-span-full text-center text-gray-500 py-8">Không tìm thấy môn học nào khớp.</p>';
            return;
        }

        categories.forEach(category => {
            const totalQuizzes = quizDatabase.filter(q => q.category === category).length;
            const card = document.createElement('div');
            
            card.className = 'relative p-6 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-2xl shadow-sm hover:shadow-xl transition-all cursor-pointer flex items-center justify-between group';
            
            let shareBtnHTML = '';
            if (checkIsMasterAdmin() || currentRole === 'teacher') {
                const folderLink = `${window.location.origin}${window.location.pathname}?folder=${encodeURIComponent(category)}&t=${auth.currentUser.uid}`;
                shareBtnHTML = `<button onclick="event.stopPropagation(); copyLink('${folderLink}')" class="absolute top-4 right-4 text-gray-400 hover:text-blue-500 bg-gray-100 dark:bg-gray-800 rounded-full w-8 h-8 flex items-center justify-center shadow-sm transition-colors z-10" title="Chia sẻ toàn bộ môn này"><i class="fas fa-share-alt"></i></button>`;
            } else if (currentRole === 'student') {
                const catQuiz = quizDatabase.find(q => q.category === category);
                const tId = catQuiz ? catQuiz.authorId : '';
                shareBtnHTML = `<button onclick="event.stopPropagation(); unpinFolder('${category}', '${tId}')" class="absolute top-4 right-4 text-blue-500 hover:text-red-500 bg-blue-50 dark:bg-gray-800 rounded-full w-8 h-8 flex items-center justify-center shadow-sm transition-colors z-10" title="Bỏ ghim thư mục"><i class="fas fa-bookmark"></i></button>`;
            }

            card.innerHTML = `
                ${shareBtnHTML}
                <div class="flex items-center gap-4">
                    <div class="w-14 h-14 bg-blue-50 dark:bg-gray-800 text-blue-900 dark:text-blue-400 rounded-xl flex items-center justify-center text-2xl group-hover:bg-blue-900 group-hover:text-white transition-colors">
                        <i class="fas fa-folder"></i>
                    </div>
                    <div>
                        <h3 class="text-xl font-bold text-gray-800 dark:text-white group-hover:text-blue-900 dark:group-hover:text-blue-400 transition-colors">${category}</h3>
                        <p class="text-sm text-gray-400 mt-1">Gồm có ${totalQuizzes} bộ đề</p>
                    </div>
                </div>
                <div class="text-gray-300 group-hover:text-blue-900 dark:group-hover:text-blue-400 transition-colors pr-6"><i class="fas fa-chevron-right text-xl"></i></div>
            `;
            card.onclick = () => { currentSelectedCategory = category; switchScreen('subjectDetail'); };
            container.appendChild(card);
        });
    } 
    else if (currentRole === 'student' && currentStudentTab === 'history') {
        if (!auth.currentUser) return;
        
        if (!isHistoryLoaded) {
            container.innerHTML = '<p class="col-span-full text-center text-gray-500 py-8 animate-pulse">Đang tải dữ liệu lịch sử...</p>'; 
            return;
        }

        let filteredHistory = historyDatabase;
        if (keyword) {
            filteredHistory = historyDatabase.filter(item => 
                (item.data.quizTitle && item.data.quizTitle.toLowerCase().includes(keyword)) ||
                (item.data.category && item.data.category.toLowerCase().includes(keyword))
            );
        }

        if (filteredHistory.length === 0) {
            container.innerHTML = '<p class="col-span-full text-center text-gray-500 py-8">Không tìm thấy lịch sử bài thi nào khớp.</p>'; return;
        }

        filteredHistory.forEach(item => {
            const res = item.data;
            const formatStr = res.timestamp ? new Date(res.timestamp.seconds * 1000).toLocaleString('vi-VN') : "Vừa xong";
            
            const card = document.createElement('div');
            card.className = 'p-5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-2xl shadow-sm flex flex-col justify-between gap-4 relative group';
            
            let isMock = res.quizId && (String(res.quizId).startsWith("MOCK-") || String(res.quizId).startsWith("ERROR-CORRECTION-"));
            let actionBtnHTML = isMock ? '' : `<button onclick="redoQuizFromHistory('${res.quizId}')" class="px-3 py-1.5 bg-blue-900 text-white text-xs font-bold rounded-lg hover:bg-blue-800 transition-colors"><i class="fas fa-redo mr-1"></i>Làm lại</button>`;
            let reviewBtnHTML = `<button onclick="reviewPastQuiz('${res.quizId}', '${item.id}')" class="px-3 py-1.5 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700 transition-colors mr-2"><i class="fas fa-eye mr-1"></i>Xem lại</button>`;
            let errorBtnHTML = `<button onclick="generateErrorCorrection('${item.id}')" class="px-3 py-1.5 bg-orange-500 text-white text-xs font-bold rounded-lg hover:bg-orange-600 transition-colors mr-2"><i class="fas fa-tools mr-1"></i>Vá lỗi sai</button>`;

            card.innerHTML = `
                <button onclick="deleteHistoryEntry('${item.id}')" class="absolute top-4 right-4 text-gray-400 hover:text-red-500 bg-gray-50 dark:bg-gray-800 rounded-full w-8 h-8 flex items-center justify-center shadow-sm transition-colors" title="Xóa dữ liệu"><i class="fas fa-times"></i></button>
                <div>
                    <span class="text-[0.7rem] px-2 py-0.5 bg-purple-50 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300 rounded-full font-bold border dark:border-purple-800">${res.category}</span>
                    <h3 class="text-base font-bold text-gray-800 dark:text-white mt-2 pr-6 line-clamp-2">${res.quizTitle}</h3>
                    <p class="text-[0.7rem] text-gray-400 mt-1"><i class="far fa-clock"></i> Cập nhật: ${formatStr}</p>
                    
                    <div class="grid grid-cols-2 gap-2 mt-3 p-3 bg-gray-50 dark:bg-gray-800/40 rounded-xl text-xs">
                        <div><span class="text-gray-400">Đúng:</span> <strong class="text-blue-600 font-mono">${res.score}</strong></div>
                        <div><span class="text-gray-400">Tỷ lệ:</span> <strong class="${res.percentage >= 50 ? 'text-green-600' : 'text-red-500'}">${res.percentage}%</strong></div>
                        <div class="col-span-2"><span class="text-gray-400">Thời gian:</span> <strong class="text-gray-700 dark:text-gray-300 font-mono">${res.timeUsed}</strong></div>
                    </div>
                </div>
                <div class="flex justify-end border-t dark:border-gray-600 pt-2 mt-auto flex-wrap gap-y-2">
                    ${errorBtnHTML}
                    ${reviewBtnHTML}
                    ${actionBtnHTML}
                </div>
            `;
            container.appendChild(card);
        });
    }
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
                
                if (parsed.shuffledQuestions) {
                    activeQuiz.questions = parsed.shuffledQuestions;
                }
                
                shouldLoadSaved = true;
            } else {
                localStorage.removeItem('quizProgress_' + activeQuiz.id);
            }
        }
    }

    if (!shouldLoadSaved) {
        let groupedQuestions = []; let currentPassage = null; let currentGroup = [];
        activeQuiz.questions.forEach(q => {
            if (q.passage !== currentPassage) {
                if (currentGroup.length > 0) groupedQuestions.push(currentGroup);
                currentGroup = [q]; currentPassage = q.passage;
            } else { currentGroup.push(q); }
        });
        if (currentGroup.length > 0) groupedQuestions.push(currentGroup);

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

            group.forEach(q => {
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

function loadQuestion(index) {
    if(index < 0 || index >= activeQuiz.questions.length) return;
    currentQuestionIndex = index;
    const q = activeQuiz.questions[index];
    
    const counter = document.getElementById('question-counter'); if(counter) counter.innerText = `Câu ${index + 1} / ${activeQuiz.questions.length}`;
    const content = document.getElementById('question-content'); if(content) content.innerHTML = q.content;
    const passageContainer = document.getElementById('passage-container');
    const questionWrapper = document.getElementById('question-wrapper'); const passageText = document.getElementById('passage-text');

    if (q.passage && q.passage.trim() !== "") {
        if(passageContainer) passageContainer.classList.remove('hidden');
        if(questionWrapper) questionWrapper.classList.replace('w-full', 'md:w-1/2');
        if(passageText) passageText.innerHTML = q.passage;
    } else {
        if(passageContainer) passageContainer.classList.add('hidden');
        if(questionWrapper) questionWrapper.classList.replace('md:w-1/2', 'w-full');
        if(passageText) passageText.innerHTML = "";
    }

    const btnFlag = document.getElementById('btn-flag');
    if (btnFlag) {
        if (flaggedQuestions[index]) {
            btnFlag.className = 'flex-1 sm:flex-none justify-center flex items-center gap-1 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-yellow-400 text-yellow-900 rounded-lg font-bold transition-colors border border-yellow-500 text-xs sm:text-sm';
            btnFlag.innerHTML = `<i class="fas fa-flag"></i> <span class="hidden sm:inline">Đang</span> Phân vân`;
        } else {
            btnFlag.className = 'flex-1 sm:flex-none justify-center flex items-center gap-1 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-400 rounded-lg font-bold hover:bg-yellow-200 transition-colors border border-yellow-300 dark:border-yellow-700 text-xs sm:text-sm';
            btnFlag.innerHTML = `<i class="far fa-flag"></i> <span class="hidden sm:inline">Đánh dấu</span> Phân vân`;
        }
    }
    
    const optionsContainer = document.getElementById('options-container');
    if(optionsContainer) {
        optionsContainer.innerHTML = ''; 
        const labels = ['A', 'B', 'C', 'D'];
        const isAnswerRevealed = isReviewMode || (isPracticeMode && userAnswers[index] !== null);
        
        const hasExplanationAccess = checkFeatureAccess('explanation', true);

        q.options.forEach((optText, optIndex) => {
            const btn = document.createElement('button');
            let optExpText = (q.optionExplanations && q.optionExplanations[optIndex]) ? q.optionExplanations[optIndex] : "";
            
            if (!hasExplanationAccess) optExpText = ""; 

            let expBlock = ''; let labelBg = 'bg-gray-100'; let labelText = 'text-gray-500';
            let btnBorder = 'border-gray-200 dark:border-gray-600'; let btnBg = 'bg-white dark:bg-gray-800';

            if (isAnswerRevealed) {
                btn.style.pointerEvents = 'none';
                if (optIndex === q.correctAnswer) {
                    btnBorder = 'border-green-500'; btnBg = 'bg-green-50 dark:bg-green-900/20'; labelBg = 'bg-green-500'; labelText = 'text-white';
                    if (optExpText) {
                        expBlock = `<div class="mt-3 pl-11 sm:pl-14 text-sm text-green-700 dark:text-green-400 text-left">
                            <div class="font-bold mb-1"><i class="fas fa-check mr-1"></i> Chính xác</div>
                            <div class="font-academic leading-relaxed opacity-90">${optExpText}</div>
                        </div>`;
                    }
                } else if (optIndex === userAnswers[index]) {
                    btnBorder = 'border-red-500'; btnBg = 'bg-red-50 dark:bg-red-900/20'; labelBg = 'bg-red-500'; labelText = 'text-white';
                    if (optExpText) {
                        expBlock = `<div class="mt-3 pl-11 sm:pl-14 text-sm text-red-700 dark:text-red-400 text-left">
                            <div class="font-bold mb-1"><i class="fas fa-times mr-1"></i> Sai</div>
                            <div class="font-academic leading-relaxed opacity-90">${optExpText}</div>
                        </div>`;
                    }
                }
            } else {
                if (userAnswers[index] === optIndex) {
                    btnBorder = 'border-blue-600'; btnBg = 'bg-blue-50 dark:bg-blue-900/30'; btn.classList.add('ring-4', 'ring-blue-100'); labelBg = 'bg-blue-600'; labelText = 'text-white';
                }
                btn.onclick = () => { 
                    userAnswers[currentQuestionIndex] = optIndex; 
                    loadQuestion(currentQuestionIndex); 
                    saveProgressLocally(); 
                };

                btn.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    if(!checkFeatureAccess('crossout')) return;
                    if(btn.classList.contains('opacity-30')) {
                        btn.classList.remove('opacity-30', 'line-through', 'grayscale');
                    } else {
                        btn.classList.add('opacity-30', 'line-through', 'grayscale');
                    }
                });
            }

            btn.className = `option-btn text-left p-3 sm:p-4 rounded-xl flex flex-col border-2 transition-all w-full ${btnBorder} ${btnBg} ${isAnswerRevealed ? 'cursor-default' : 'cursor-pointer hover:border-blue-400 dark:hover:border-blue-500'}`;
            btn.innerHTML = `
                <div class="flex items-center gap-3 sm:gap-4 w-full">
                    <span class="option-label w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center rounded-lg ${labelBg} font-bold ${labelText} shrink-0 text-sm sm:text-base transition-colors shadow-sm">${labels[optIndex]}</span>
                    <span class="text-base sm:text-lg font-academic dark:text-gray-200">${optText}</span>
                </div>
                ${expBlock}
            `;
            optionsContainer.appendChild(btn);
        });
    }

    const hintBtn = document.getElementById('btn-hint'); const hintBox = document.getElementById('hint-box');
    if(hintBox) hintBox.classList.add('hidden');
    if(hintBtn) {
        if (isPracticeMode && !isReviewMode && q.hint && userAnswers[index] === null) hintBtn.classList.remove('hidden');
        else hintBtn.classList.add('hidden');
    }

    const bPrev = document.getElementById('btn-prev'); if(bPrev) bPrev.disabled = index === 0;
    const bNext = document.getElementById('btn-next'); if(bNext) bNext.classList.toggle('hidden', index === activeQuiz.questions.length - 1);
    
    const bSub = document.getElementById('btn-submit'); 
    if(bSub) {
        bSub.classList.toggle('hidden', index !== activeQuiz.questions.length - 1 || isReviewMode);
    }

    const explanationBox = document.getElementById('explanation-box');
    const isAnswerRevealed = isReviewMode || (isPracticeMode && userAnswers[index] !== null);
    if (explanationBox) {
        const eText = document.getElementById('explanation-text');
        if (isAnswerRevealed && q.explanation && q.explanation !== "Tạo tự động từ dữ liệu văn bản." && q.explanation !== "Chưa có giải thích.") {
            
            if(!checkFeatureAccess('explanation', true)) {
                if(eText) eText.innerHTML = `<span class="text-gray-500 italic"><i class="fas fa-lock"></i> Chi tiết giải thích yêu cầu tài khoản nâng cấp. <a href="#" onclick="switchScreen('pricing')" class="text-blue-600 font-bold underline">Xem các gói cước</a>.</span>`;
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

// [VIP CẤP CỨU] Hàm Nộp Bài bọc thép - Loại bỏ hoàn toàn mảng độc 'undefined' để Firebase không đá văng bài thi
function submitQuiz(force) {
    const timeUsed = activeQuiz.timeLimit - (timeLeft > 0 ? timeLeft : 0);
    const minimumTime = Math.floor(activeQuiz.timeLimit / 2);

    if (!force && timeUsed < minimumTime && !isPracticeMode) {
        showToast("Hệ thống từ chối nộp bài. Vui lòng làm bài ít nhất 50% thời gian quy định.", true);
        return; 
    }

    if (force || confirm("Xác nhận nộp bài thi?")) {
        clearInterval(timerInterval);
        exitFullscreen();
        localStorage.removeItem('quizProgress_' + activeQuiz.id);

        let correctCount = userAnswers.filter((ans, i) => ans === activeQuiz.questions[i].correctAnswer).length;
        const finalTimeUsed = activeQuiz.timeLimit - (timeLeft > 0 ? timeLeft : 0);
        const timeUsedStr = `${Math.floor(finalTimeUsed / 60).toString().padStart(2, '0')}:${(finalTimeUsed % 60).toString().padStart(2, '0')}`;
        
        let percent = 0;
        if (activeQuiz.questions && activeQuiz.questions.length > 0) {
            percent = Math.round((correctCount / activeQuiz.questions.length) * 100);
        }

        switchScreen('result');
        const sc = document.getElementById('result-score'); if(sc) sc.innerText = `${correctCount}/${activeQuiz.questions.length}`;
        const pc = document.getElementById('result-percent'); if(pc) pc.innerText = `${percent}%`;
        const tc = document.getElementById('result-time'); 
        if(tc) tc.innerText = isPracticeMode ? "Không giới hạn" : timeUsedStr;

       
        // THUẬT TOÁN ĐÓNG GÓI - Chặn tuyệt đối giá trị "undefined" làm kẹt Firebase
        const rawPayload = {
            quizId: activeQuiz.id || "UNKNOWN", 
            quizTitle: activeQuiz.title || "Chưa đặt tên", 
            category: activeQuiz.category || "Chưa phân loại",
            studentName: studentName || "Ẩn danh", 
            email: auth.currentUser ? auth.currentUser.email : "Ẩn danh",
            uid: auth.currentUser ? auth.currentUser.uid : "UNKNOWN",
            score: `${correctCount}/${activeQuiz.questions.length}`, 
            percentage: percent, 
            timeUsed: isPracticeMode ? "Luyện tập" : timeUsedStr,
            teacherId: activeQuiz.authorId || "GUEST", 
            userAnswers: userAnswers || [], 
            quizQuestionsSnapshot: activeQuiz.questions || []
        };

        // Ép sang chuẩn JSON để tự động bốc hơi mọi trường 'undefined' lỗi
        const cleanPayload = JSON.parse(JSON.stringify(rawPayload));
        cleanPayload.timestamp = firebase.firestore.FieldValue.serverTimestamp();

        // [ĐÃ VÁ] Đẩy thẳng lên đám mây, đám mây sẽ tự động gọi hệ thống nạp lại Lịch sử
        db.collection("results").add(cleanPayload).catch(err => {
            console.error("Lỗi cập nhật điểm: ", err);
            showToast("Lỗi hệ thống: Không thể kết nối với máy chủ đám mây", true);
        });
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
    if (tab === 'users' && !checkIsMasterAdmin()) {
        showToast("Chỉ có bậc Hoàng đế tối cao mới có quyền sắc phong đặc quyền VIP.", true);
        return;
    }

    const panels = ['panel-smart', 'panel-manual', 'panel-stats', 'panel-users'];
    panels.forEach(p => {
        const el = document.getElementById(p);
        if(el) el.style.display = p === 'panel-' + tab ? 'block' : 'none';
    });
    
    const tabs = ['smart', 'manual', 'stats', 'users'];
    tabs.forEach(t => {
        const btn = document.getElementById('tab-' + t);
        if(btn) {
            btn.className = t === tab ? 
                "flex-1 md:flex-none px-3 sm:px-4 py-2 text-sm sm:text-base font-bold rounded-lg bg-blue-100 text-blue-700" : 
                "flex-1 md:flex-none px-3 sm:px-4 py-2 text-sm sm:text-base font-bold rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700";
        }
    });

    if (tab === 'stats') fetchResultsFromFirebase();
}

function fetchResultsFromFirebase() {
    const tableBody = document.getElementById('stats-table-body'); if(!tableBody) return;
    tableBody.innerHTML = '<tr><td colspan="6" class="text-center py-4">Đang xử lý dữ liệu...</td></tr>';
    if (!auth.currentUser) return;

    db.collection("results").where("teacherId", "==", auth.currentUser.uid).get().then((snapshot) => {
        tableBody.innerHTML = '';
        if (snapshot.empty) { tableBody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-500">Chưa có dữ liệu bài làm.</td></tr>'; return; }

        let results = []; snapshot.forEach(doc => results.push(doc.data()));
        results.sort((a, b) => { let timeA = a.timestamp ? a.timestamp.seconds : 0; let timeB = b.timestamp ? b.timestamp.seconds : 0; return timeB - timeA; });

        results.forEach((res) => {
            const formatStr = res.timestamp ? new Date(res.timestamp.seconds * 1000).toLocaleString('vi-VN') : "Vừa xong";
            const row = document.createElement('tr'); row.className = 'border-b dark:border-gray-700 text-sm hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors';
            row.innerHTML = `
                <td class="p-2 sm:p-3 font-semibold text-gray-900 dark:text-gray-100">${res.studentName}</td>
                <td class="p-2 sm:p-3 text-gray-600 dark:text-gray-400">
                    <span class="font-medium">${res.quizTitle}</span>
                    <span class="text-xs px-2 py-0.5 bg-blue-50 dark:bg-blue-900 text-blue-600 dark:text-blue-300 rounded-full ml-1 font-bold">${res.category}</span>
                </td>
                <td class="p-2 sm:p-3 font-mono font-bold text-blue-600 dark:text-blue-400">${res.score}</td>
                <td class="p-2 sm:p-3 font-bold ${res.percentage >= 50 ? 'text-green-600' : 'text-red-500'}">${res.percentage}%</td>
                <td class="p-2 sm:p-3 text-gray-500 dark:text-gray-400">${res.timeUsed}</td>
                <td class="p-2 sm:p-3 text-gray-400 text-xs">${formatStr}</td>
            `;
            tableBody.appendChild(row);
        });
    }).catch(err => { tableBody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-red-500">Lỗi kết nối máy chủ.</td></tr>'; });
}

let currentSmartQuestions = [];
function processSmartText() {
    let text = document.getElementById('smart-input-area').value; text = text.replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ');
    const regex = /(?=\[Bài đọc\]|\[Hết bài đọc\]|Câu \d+[:.])/i;
    const blocks = text.split(regex).filter(q => q.trim().length > 0);
    
    currentSmartQuestions = []; let currentPassage = ""; let previewHTML = "";
    
    blocks.forEach((block) => {
        let trimmed = block.trim();
        if (trimmed.match(/^\[Bài đọc\]/i)) { currentPassage = trimmed.replace(/^\[Bài đọc\]/i, '').trim(); } 
        else if (trimmed.match(/^\[Hết bài đọc\]/i)) { currentPassage = ""; } 
        else if (trimmed.match(/^Câu \d+[:.]/i)) {
            let parseRegex = /([\s\S]*?)(?:^|\s+)([*#]*)[Aa]\s*[.)\-:/]([\s\S]*?)(?:^|\s+)([*#]*)[Bb]\s*[.)\-:/]([\s\S]*?)(?:^|\s+)([*#]*)[Cc]\s*[.)\-:/]([\s\S]*?)(?:^|\s+)([*#]*)[Dd]\s*[.)\-:/]([\s\S]*)/i;
            let match = trimmed.match(parseRegex);

            if (match) {
                let content = match[1].replace(/^Câu \d+[:.]/i, '').trim();
                let optA = match[3].trim(); let optB = match[5].trim(); let optC = match[7].trim(); 
                let rawOptD = match[9].trim();
                
                let correctIndex = 0; 
                if (match[2].includes('*') || match[2].includes('#')) correctIndex = 0;
                if (match[4].includes('*') || match[4].includes('#')) correctIndex = 1;
                if (match[6].includes('*') || match[6].includes('#')) correctIndex = 2;
                if (match[8].includes('*') || match[8].includes('#')) correctIndex = 3;

                let globalExpl = "Tạo tự động từ dữ liệu văn bản.";
                
                let explRegex = /(?:\n|\s|^)(?:giải thích|lời giải|hd|hướng dẫn)[\s]*:(.*)/is;
                let explMatch = rawOptD.match(explRegex);
                if (explMatch) {
                    globalExpl = explMatch[1].trim(); 
                    rawOptD = rawOptD.replace(explMatch[0], '').trim(); 
                }

                let ansRegex = /(?:\n|\s|^)(?:đáp án)[\s]*:(.*)/is;
                let ansMatch = rawOptD.match(ansRegex);
                if (ansMatch) {
                    let ansChar = ansMatch[1].trim().charAt(0).toUpperCase();
                    if (ansChar === 'A') correctIndex = 0;
                    else if (ansChar === 'B') correctIndex = 1;
                    else if (ansChar === 'C') correctIndex = 2;
                    else if (ansChar === 'D') correctIndex = 3;
                    
                    rawOptD = rawOptD.replace(ansMatch[0], '').trim();
                } else if (rawOptD.toLowerCase().includes("đáp án")) {
                    rawOptD = rawOptD.split(/đáp án/i)[0].trim();
                }

                let splitA = optA.split('::'); optA = splitA[0].trim(); let expA = splitA[1] ? splitA[1].trim() : "";
                let splitB = optB.split('::'); optB = splitB[0].trim(); let expB = splitB[1] ? splitB[1].trim() : "";
                let splitC = optC.split('::'); optC = splitC[0].trim(); let expC = splitC[1] ? splitC[1].trim() : "";
                let splitD = rawOptD.split('::'); let optD = splitD[0].trim(); let expD = splitD[1] ? splitD[1].trim() : "";

                currentSmartQuestions.push({
                    content: content, options: [optA, optB, optC, optD], optionExplanations: [expA, expB, expC, expD],
                    correctAnswer: correctIndex, explanation: globalExpl, passage: currentPassage 
                });
                
                const labels = ['A', 'B', 'C', 'D'];
                
                let previewExplHTML = (globalExpl !== "Tạo tự động từ dữ liệu văn bản.") ? 
                    `<div class="mt-2 text-[0.7rem] text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-gray-800 p-2 rounded"><i class="fas fa-info-circle"></i> <b>Giải thích chung:</b> ${globalExpl}</div>` : '';

                previewHTML += `
                    <div class="p-3 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-sm">
                        <p class="font-bold text-sm text-gray-800 dark:text-white mb-2">Câu ${currentSmartQuestions.length}: ${content}</p>
                        <div class="grid grid-cols-1 gap-1">
                            ${[optA, optB, optC, optD].map((opt, i) => `
                                <div class="text-xs p-1.5 rounded flex items-start gap-1 ${i === correctIndex ? 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300 font-bold border border-green-200' : 'text-gray-600 dark:text-gray-300'}">
                                    <span class="font-bold w-4">${labels[i]}.</span> 
                                    <div class="flex flex-col">
                                        <span>${opt}</span>
                                        ${[expA, expB, expC, expD][i] ? `<span class="text-[0.65rem] italic mt-0.5 text-gray-500 dark:text-gray-400">Giải thích riêng: ${[expA, expB, expC, expD][i]}</span>` : ''}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                        ${previewExplHTML}
                    </div>`;
            } else {
                let c = trimmed.substring(0, 40).replace(/\n/g, ' ') + "...";
                previewHTML += `<div class="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-lg text-red-600 dark:text-red-400 text-xs font-bold"><i class="fas fa-exclamation-triangle mr-1"></i> Không thể nhận diện định dạng tại: "${c}"</div>`;
            }
        }
    });

    const sqc = document.getElementById('smart-question-count'); if (sqc) sqc.innerText = `Đã nhận diện: ${currentSmartQuestions.length} câu`;
    const spb = document.getElementById('smart-preview-box');
    if (spb) {
        if (previewHTML === "") spb.innerHTML = `<p class="text-sm text-gray-400 text-center mt-10 italic">Bản xem trước dữ liệu sẽ hiển thị tại đây.</p>`;
        else spb.innerHTML = previewHTML;
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

function addManualQuestionForm(existingData = null) {
    const container = document.getElementById('manual-questions-container'); if(!container) return;
    const qDiv = document.createElement('div'); qDiv.className = 'manual-q-block p-4 sm:p-6 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl relative';
    
    let exp0 = existingData && existingData.optionExplanations && existingData.optionExplanations[0] ? " :: " + existingData.optionExplanations[0] : "";
    let exp1 = existingData && existingData.optionExplanations && existingData.optionExplanations[1] ? " :: " + existingData.optionExplanations[1] : "";
    let exp2 = existingData && existingData.optionExplanations && existingData.optionExplanations[2] ? " :: " + existingData.optionExplanations[2] : "";
    let exp3 = existingData && existingData.optionExplanations && existingData.optionExplanations[3] ? " :: " + existingData.optionExplanations[3] : "";

    let pass = existingData && existingData.passage ? existingData.passage : "";
    let cont = existingData && existingData.content ? existingData.content : "";
    
    let opt0 = ((existingData && existingData.options && existingData.options[0]) ? existingData.options[0] : "") + exp0;
    let opt1 = ((existingData && existingData.options && existingData.options[1]) ? existingData.options[1] : "") + exp1;
    let opt2 = ((existingData && existingData.options && existingData.options[2]) ? existingData.options[2] : "") + exp2;
    let opt3 = ((existingData && existingData.options && existingData.options[3]) ? existingData.options[3] : "") + exp3;
    
    opt0 = opt0.replace(/"/g, '&quot;');
    opt1 = opt1.replace(/"/g, '&quot;');
    opt2 = opt2.replace(/"/g, '&quot;');
    opt3 = opt3.replace(/"/g, '&quot;');

    let corr = existingData && existingData.correctAnswer !== undefined ? existingData.correctAnswer : 0;
    let expl = existingData && existingData.explanation ? existingData.explanation.replace(/"/g, '&quot;') : "";

    qDiv.innerHTML = `
        <button onclick="this.parentElement.remove()" class="absolute top-3 right-3 sm:top-4 sm:right-4 text-gray-400 hover:text-red-500 transition-colors"><i class="fas fa-times text-lg sm:text-xl"></i></button>
        <h4 class="font-bold mb-3 sm:mb-4 dark:text-white text-blue-600 text-sm sm:text-base">Nội dung câu hỏi</h4>
        <div class="mb-3 sm:mb-4">
            <label class="text-xs sm:text-sm font-bold text-gray-500 dark:text-gray-400">Đoạn văn (Bỏ trống nếu không có):</label>
            <textarea placeholder="Nội dung bài đọc..." class="q-passage w-full p-2 sm:p-3 mt-1 border rounded outline-none focus:border-blue-500 dark:bg-gray-800 dark:text-white dark:border-gray-600 text-sm sm:text-base" rows="3">${pass}</textarea>
        </div>
        <textarea placeholder="Nội dung câu hỏi chính..." class="q-content w-full p-2 sm:p-3 mb-3 sm:mb-4 border rounded outline-none focus:border-blue-500 dark:bg-gray-800 dark:text-white dark:border-gray-600 text-sm sm:text-base" rows="2">${cont}</textarea>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 mb-3 sm:mb-4">
            <input type="text" placeholder="Lựa chọn A" class="q-opt-0 p-2 border rounded dark:bg-gray-800 dark:text-white dark:border-gray-600 outline-none text-sm sm:text-base" value="${opt0}">
            <input type="text" placeholder="Lựa chọn B" class="q-opt-1 p-2 border rounded dark:bg-gray-800 dark:text-white dark:border-gray-600 outline-none text-sm sm:text-base" value="${opt1}">
            <input type="text" placeholder="Lựa chọn C" class="q-opt-2 p-2 border rounded dark:bg-gray-800 dark:text-white dark:border-gray-600 outline-none text-sm sm:text-base" value="${opt2}">
            <input type="text" placeholder="Lựa chọn D" class="q-opt-3 p-2 border rounded dark:bg-gray-800 dark:text-white dark:border-gray-600 outline-none text-sm sm:text-base" value="${opt3}">
        </div>
        <div class="flex flex-col sm:flex-row gap-2 sm:gap-4 items-start sm:items-center">
            <label class="font-bold dark:text-gray-300 text-sm sm:text-base">Đáp án đúng:</label>
            <select class="q-correct p-2 border rounded outline-none dark:bg-gray-800 dark:text-white dark:border-gray-600 w-full sm:w-auto text-sm sm:text-base">
                <option value="0" ${corr === 0 ? 'selected' : ''}>A</option>
                <option value="1" ${corr === 1 ? 'selected' : ''}>B</option>
                <option value="2" ${corr === 2 ? 'selected' : ''}>C</option>
                <option value="3" ${corr === 3 ? 'selected' : ''}>D</option>
            </select>
        </div>
        <input type="text" placeholder="Giải thích chi tiết (Tùy chọn)..." class="q-expl w-full p-2 mt-3 sm:mt-4 border rounded outline-none dark:bg-gray-800 dark:text-white dark:border-gray-600 text-sm sm:text-base" value="${expl}">
    `;
    container.appendChild(qDiv);
}

function saveManualQuiz() {
    const titleEl = document.getElementById('manual-title'); const catEl = document.getElementById('manual-category'); const timeEl = document.getElementById('manual-time'); const testEl = document.getElementById('manual-test-only');
    const title = titleEl ? titleEl.value.trim() : ""; const category = catEl ? catEl.value.trim() : "";
    const manualMinutes = timeEl ? timeEl.value : ""; const timeLimit = parseInt(manualMinutes) * 60; const isTestOnly = testEl ? testEl.checked : false; 
    if (!title || !category || isNaN(timeLimit) || timeLimit <= 0) return alert("Vui lòng điền đủ Tên đề, Môn học và Thời gian quy định.");
    const qBlocks = document.querySelectorAll('.manual-q-block'); if (qBlocks.length === 0) return alert("Vui lòng tạo ít nhất 1 câu hỏi.");

    let questions = []; let isValid = true;
    qBlocks.forEach(block => {
        const passage = block.querySelector('.q-passage').value.trim(); const content = block.querySelector('.q-content').value.trim();
        
        let rawA = block.querySelector('.q-opt-0').value.trim();
        let rawB = block.querySelector('.q-opt-1').value.trim();
        let rawC = block.querySelector('.q-opt-2').value.trim();
        let rawD = block.querySelector('.q-opt-3').value.trim();
        
        if (!content || rawA === "" || rawB === "" || rawC === "" || rawD === "") isValid = false;
        
        let splitA = rawA.split('::'); let optA = splitA[0].trim(); let expA = splitA[1] ? splitA[1].trim() : "";
        let splitB = rawB.split('::'); let optB = splitB[0].trim(); let expB = splitB[1] ? splitB[1].trim() : "";
        let splitC = rawC.split('::'); let optC = splitC[0].trim(); let expC = splitC[1] ? splitC[1].trim() : "";
        let splitD = rawD.split('::'); let optD = splitD[0].trim(); let expD = splitD[1] ? splitD[1].trim() : "";
        
        const correct = parseInt(block.querySelector('.q-correct').value); const expl = block.querySelector('.q-expl').value.trim() || "Chưa có giải thích.";
        
        questions.push({ 
            passage: passage, 
            content: content, 
            options: [optA, optB, optC, optD], 
            optionExplanations: [expA, expB, expC, expD], 
            correctAnswer: correct, 
            explanation: expl 
        });
    });

    if (!isValid) return alert("Vui lòng hoàn thiện nội dung câu hỏi và 4 lựa chọn.");
    
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

let currentSelectionRange = null;

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
    if (tab === 'stats') {
        if (!checkFeatureAccess('stats_basic')) {
            switchSubjectTab('list');
            return;
        }
        renderSubjectStats();
    }
    
    const btnList = document.getElementById('tab-btn-list');
    const btnStats = document.getElementById('tab-btn-stats');
    
    if(tab === 'list') {
        if (btnList) btnList.className = "pb-3 text-base sm:text-lg font-bold text-blue-700 border-b-4 border-blue-700 dark:text-blue-400 dark:border-blue-400 transition-all";
        if (btnStats) btnStats.className = "pb-3 text-base sm:text-lg font-bold text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 border-b-4 border-transparent transition-all flex items-center";
        document.getElementById('subject-tab-list').classList.remove('hidden');
        document.getElementById('subject-tab-stats').classList.add('hidden');
    } else {
        if (btnStats) btnStats.className = "pb-3 text-base sm:text-lg font-bold text-indigo-600 border-b-4 border-indigo-600 dark:text-indigo-400 dark:border-indigo-400 transition-all flex items-center";
        if (btnList) btnList.className = "pb-3 text-base sm:text-lg font-bold text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 border-b-4 border-transparent transition-all";
        document.getElementById('subject-tab-list').classList.add('hidden');
        document.getElementById('subject-tab-stats').classList.remove('hidden');
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
