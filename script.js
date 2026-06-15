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
let activeQuiz = null; 
let currentQuestionIndex = 0;
let studentName = "";
let isPracticeMode = false, isReviewMode = false;
let tabSwitchCount = 0, timerInterval, timeLeft = 0;
let userAnswers = [], flaggedQuestions = [];
let currentRole = 'student';
let currentFilter = 'all'; 
let isLoginMode = true; 
let currentSelectedCategory = ""; 
let currentStudentTab = "browse"; 
let screens = {}; 

let currentPlan = 'basic';
let mockGeneratedThisMonth = 0;
let lastMockMonth = null;

// --- 3. THEO DÕI TRẠNG THÁI & KHỞI TẠO ---
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

            db.collection("users").doc(user.uid).get().then(doc => {
                if(doc.exists) {
                    currentPlan = doc.data().plan || 'basic';
                    mockGeneratedThisMonth = doc.data().mockGeneratedThisMonth || 0;
                    lastMockMonth = doc.data().lastMockMonth || null;
                    
                    db.collection("users").doc(user.uid).update({ email: user.email.toLowerCase() });
                    
                    let currentMonth = new Date().getMonth();
                    if(lastMockMonth !== currentMonth) {
                        mockGeneratedThisMonth = 0;
                        lastMockMonth = currentMonth;
                        db.collection("users").doc(user.uid).update({mockGeneratedThisMonth: 0, lastMockMonth: currentMonth});
                    }
                    
                    if (typeof updatePlanBadge === 'function') updatePlanBadge();

                } else {
                    db.collection("users").doc(user.uid).set({
                        email: user.email.toLowerCase(),
                        plan: 'basic',
                        mockGeneratedThisMonth: 0,
                        lastMockMonth: new Date().getMonth()
                    });
                    currentPlan = 'basic';
                    
                    if (typeof updatePlanBadge === 'function') updatePlanBadge();
                }
            });

            // XỬ LÝ ĐƯỜNG DẪN CHIA SẺ
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
        'plus': ['highlight', 'fullscreen', 'explanation', 'autosave', 'roadmap', 'adaptive'],
        'pro': ['highlight', 'fullscreen', 'explanation', 'autosave', 'roadmap', 'adaptive', 'crossout', 'error_correction'],
        'ultra': ['highlight', 'fullscreen', 'explanation', 'autosave', 'roadmap', 'adaptive', 'crossout', 'error_correction', 'infinite_mock']
    };

    const userFeatures = plans[currentPlan] || plans['basic'];
    
    if (!userFeatures.includes(feature)) {
        if(!silent) {
            showToast("Tính năng này yêu cầu nâng cấp gói cước để sử dụng.");
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
        flaggedQuestions: flaggedQuestions
    };
    localStorage.setItem('quizProgress_' + activeQuiz.id, JSON.stringify(progress));
}

function fetchQuizzesFromFirebase() {
    if (!auth.currentUser) return;
    db.collection("quizzes")
      .where("authorId", "==", auth.currentUser.uid)
      .onSnapshot((snapshot) => {
        quizDatabase = [];
        snapshot.forEach((doc) => { quizDatabase.push(doc.data()); });
        if (screens.home && !screens.home.classList.contains('hidden')) renderHomeQuizList(); 
        if (screens.subjectDetail && !screens.subjectDetail.classList.contains('hidden')) renderSubjectDetailView(currentSelectedCategory);
    }, (error) => { console.error("Lỗi tải dữ liệu: ", error); });
}

function checkUrlForSharedQuiz(quizId) {
    db.collection("quizzes").doc(quizId).get().then((doc) => {
        if (doc.exists) {
            activeQuiz = doc.data(); prepareWelcomeScreen();
        } else {
            showToast("Đề thi này không tồn tại hoặc đã bị xóa khỏi hệ thống."); switchScreen('home');
        }
        window.history.replaceState({}, document.title, window.location.pathname);
    }).catch(err => { console.error("Lỗi đường dẫn: ", err); switchScreen('home'); });
}

// XỬ LÝ MỞ THƯ MỤC ĐƯỢC CHIA SẺ
function loadSharedFolder(category, teacherId) {
    showToast("Đang tải dữ liệu môn học...", false);
    
    db.collection("quizzes")
      .where("authorId", "==", teacherId)
      .where("category", "==", category)
      .get().then(snapshot => {
          if(snapshot.empty) {
              showToast("Thư mục này hiện tại không có dữ liệu.");
              switchScreen('home');
              return;
          }
          
          quizDatabase = []; 
          snapshot.forEach(doc => { quizDatabase.push(doc.data()); });
          
          currentSelectedCategory = category;
          switchScreen('subjectDetail'); 
          showToast(`Đã tải thành công thư mục: ${category}`, false);
          
          window.history.replaceState({}, document.title, window.location.pathname);
      }).catch(err => {
          showToast("Lỗi khi tải thư mục: " + err.message);
          switchScreen('home');
      });
}

function copyLink(link) {
    navigator.clipboard.writeText(link).then(() => { showToast("Đã sao chép liên kết thành công.", false); });
}

function setupEventListeners() {
    const addEvt = (id, event, handler) => { const el = document.getElementById(id); if (el) el.addEventListener(event, handler); };

    addEvt('btn-auth-toggle', 'click', () => toggleAuthMode(!isLoginMode));
    addEvt('btn-auth-submit', 'click', handleAuthSubmit);
    addEvt('btn-logout', 'click', () => { if(confirm("Xác nhận đăng xuất?")) auth.signOut(); });
    addEvt('role-student', 'click', () => setRole('student'));
    addEvt('role-teacher', 'click', () => setRole('teacher'));
    addEvt('btn-theme-toggle', 'click', toggleDarkMode);
    addEvt('btn-show-admin', 'click', () => switchScreen('admin'));
    
    const goHome = () => { window.history.pushState({}, '', window.location.pathname); switchScreen('home'); };
    addEvt('btn-back-to-home', 'click', goHome);
    addEvt('btn-back-to-subject', 'click', () => switchScreen('subjectDetail'));
    addEvt('btn-home', 'click', goHome);
    
    addEvt('btn-exit-quiz', 'click', () => {
        if (isReviewMode) {
            switchScreen('result');
        } else if (confirm("Thoát? Tiến trình làm bài sẽ được tự động lưu (áp dụng cho tài khoản đăng ký gói).")) {
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
    if (!email || !password) return alert("Vui lòng nhập đủ thông tin.");
    if (isLoginMode) { auth.signInWithEmailAndPassword(email, password).catch(err => showToast("Đăng nhập thất bại: Kiểm tra lại thông tin.", true)); } 
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
    if (screenName === 'admin' && !checkIsMasterAdmin()) {
        showToast("Tài khoản không có quyền truy cập khu vực này.");
        return;
    }

    const toast = document.getElementById('system-toast');
    if (toast) {
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
    
    if (currentRole === 'teacher' || currentStudentTab === 'browse') {
        if (quizDatabase.length === 0) {
            container.innerHTML = '<p class="col-span-full text-center text-gray-500 py-8">Chưa có dữ liệu môn học.</p>';
            return;
        }

        const categories = [...new Set(quizDatabase.map(q => q.category))];
        categories.forEach(category => {
            const totalQuizzes = quizDatabase.filter(q => q.category === category).length;
            const card = document.createElement('div');
            
            card.className = 'relative p-6 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-2xl shadow-sm hover:shadow-xl transition-all cursor-pointer flex items-center justify-between group';
            
            let shareBtnHTML = '';
            if (checkIsMasterAdmin() || currentRole === 'teacher') {
                const folderLink = `${window.location.origin}${window.location.pathname}?folder=${encodeURIComponent(category)}&t=${auth.currentUser.uid}`;
                shareBtnHTML = `<button onclick="event.stopPropagation(); copyLink('${folderLink}')" class="absolute top-4 right-4 text-gray-400 hover:text-blue-500 bg-gray-100 dark:bg-gray-800 rounded-full w-8 h-8 flex items-center justify-center shadow-sm transition-colors z-10" title="Chia sẻ toàn bộ môn này"><i class="fas fa-share-alt"></i></button>`;
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
        container.innerHTML = '<p class="col-span-full text-center text-gray-500 py-4">Đang tải lịch sử...</p>';
        
        db.collection("results").where("uid", "==", auth.currentUser.uid).get().then((snapshot) => {
            container.innerHTML = '';
            if (snapshot.empty) {
                container.innerHTML = '<p class="col-span-full text-center text-gray-500 py-8">Bạn chưa thực hiện bài thi nào.</p>'; return;
            }
            
            let listHistory = [];
            snapshot.forEach(doc => { listHistory.push({ id: doc.id, data: doc.data() }); });
            listHistory.sort((a, b) => {
                let sA = a.data.timestamp ? a.data.timestamp.seconds : 0;
                let sB = b.data.timestamp ? b.data.timestamp.seconds : 0;
                return sB - sA;
            });

            listHistory.forEach(item => {
                const res = item.data;
                const formatStr = res.timestamp ? new Date(res.timestamp.seconds * 1000).toLocaleString('vi-VN') : "Vừa xong";
                
                const card = document.createElement('div');
                card.className = 'p-5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-2xl shadow-sm flex flex-col justify-between gap-4 relative group';
                
                let isMock = res.quizId.startsWith("MOCK-") || res.quizId.startsWith("ERROR-CORRECTION-");
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
        }).catch(err => { container.innerHTML = '<p class="col-span-full text-center text-red-500 py-4">Lỗi kết nối cơ sở dữ liệu.</p>'; });
    }
}

function redoQuizFromHistory(quizId) {
    db.collection("quizzes").doc(quizId).get().then((doc) => {
        if (doc.exists) { activeQuiz = doc.data(); prepareWelcomeScreen(); } 
        else { showToast("Đề thi này không tồn tại hoặc đã bị gỡ bỏ."); }
    }).catch(err => showToast("Lỗi tải đề thi: " + err.message));
}

window.generateErrorCorrection = function(resultDocId) {
    if(!checkFeatureAccess('error_correction')) return; 
    showToast("Đang xử lý dữ liệu câu sai...", false);
    
    db.collection("results").doc(resultDocId).get().then((resDoc) => {
        if (resDoc.exists) {
            const pastData = resDoc.data();
            if (!pastData.quizQuestionsSnapshot) return showToast("Dữ liệu không hỗ trợ tính năng này.");
            
            let wrongQuestions = [];
            pastData.userAnswers.forEach((ans, idx) => {
                if (ans === null || ans !== pastData.quizQuestionsSnapshot[idx].correctAnswer) {
                    wrongQuestions.push(pastData.quizQuestionsSnapshot[idx]);
                }
            });

            if (wrongQuestions.length === 0) return showToast("Không có câu trả lời sai trong bài thi này.", false);

            activeQuiz = {
                id: "ERROR-CORRECTION-" + Date.now(),
                title: `[Ôn Tập] - ` + pastData.quizTitle,
                category: pastData.category,
                timeLimit: wrongQuestions.length * 60, 
                questions: wrongQuestions,
                isTestOnly: false,
                authorId: auth.currentUser ? auth.currentUser.uid : "GUEST"
            };
            prepareWelcomeScreen();
        }
    }).catch(err => showToast("Lỗi xử lý dữ liệu: " + err.message));
}

function reviewPastQuiz(quizId, resultDocId) {
    db.collection("quizzes").doc(quizId).get().then((quizDoc) => {
        if (!quizDoc.exists) return showToast("Đề thi gốc không còn tồn tại trên hệ thống.");
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
                generateRoadmap(pastData.percentage);

                switchScreen('result');
            }
        });
    }).catch(err => showToast("Lỗi tải thông tin: " + err.message));
}

function deleteHistoryEntry(docId) {
    if (confirm("Xác nhận xóa kết quả này khỏi lịch sử?")) {
        db.collection("results").doc(docId).delete().then(() => { renderHomeQuizList(); }).catch(err => showToast("Lỗi khi xóa: " + err.message));
    }
}

function renderSubjectDetailView(category) {
    const titleEl = document.getElementById('subject-detail-title'); if(titleEl) titleEl.innerText = "Môn học: " + category;
    const container = document.getElementById('chapter-list-container'); if(!container) return;
    container.innerHTML = '';

    const quizzesInFolder = quizDatabase.filter(q => q.category === category);
    if(quizzesInFolder.length === 0) {
        container.innerHTML = '<p class="col-span-full text-center text-gray-500 py-4">Thư mục hiện tại chưa có đề thi.</p>'; return;
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
                <button onclick="event.stopPropagation(); copyLink('${shareLink}')" class="absolute top-4 right-14 text-gray-400 hover:text-blue-500 transition-colors bg-gray-100 dark:bg-gray-800 rounded-full w-8 h-8 flex items-center justify-center shadow-sm" title="Sao chép liên kết"><i class="fas fa-link"></i></button>
                <button onclick="event.stopPropagation(); deleteQuiz('${quiz.id}')" class="absolute top-4 right-4 text-gray-400 hover:text-red-500 transition-colors bg-gray-100 dark:bg-gray-800 rounded-full w-8 h-8 flex items-center justify-center shadow-sm" title="Xóa đề"><i class="fas fa-trash-alt"></i></button>
            `;
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
    if (!activeQuiz) return showToast("Đề thi không tồn tại.");
    prepareWelcomeScreen();
}

function deleteQuiz(quizId) {
    if (confirm("Xác nhận xóa vĩnh viễn đề thi này khỏi hệ thống?")) {
        db.collection("quizzes").doc(quizId).delete().then(() => { renderSubjectDetailView(currentSelectedCategory); }).catch(err => showToast("Lỗi hệ thống: " + err));
    }
}

window.generateCategoryErrorMock = function() {
    if(!checkFeatureAccess('error_correction')) return;
    showToast("Đang tổng hợp dữ liệu câu sai...", false);

    const sel = document.getElementById('mock-question-count');
    const countSelect = sel ? parseInt(sel.value) : 50;

    db.collection("results").where("uid", "==", auth.currentUser.uid).where("category", "==", currentSelectedCategory).get().then(snapshot => {
        if(snapshot.empty) return showToast("Hệ thống chưa ghi nhận lịch sử câu trả lời sai trong môn này.");
        
        let uniqueWrong = {}; 
        snapshot.forEach(doc => {
            const data = doc.data();
            if(data.quizQuestionsSnapshot && data.userAnswers) {
                data.userAnswers.forEach((ans, idx) => {
                    if (ans === null || ans !== data.quizQuestionsSnapshot[idx].correctAnswer) {
                        let q = data.quizQuestionsSnapshot[idx];
                        uniqueWrong[q.content] = q; 
                    }
                });
            }
        });

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
    });
}

function generateSubjectMockTest() {
    let limit = 0;
    if(currentPlan === 'basic') limit = 0;
    else if(currentPlan === 'plus') limit = 3;
    else if(currentPlan === 'pro') limit = 15;
    else limit = 999999; 

    if(!checkIsMasterAdmin() && mockGeneratedThisMonth >= limit) {
        showToast("Đã đạt giới hạn số lần tạo đề thi thử trong tháng.");
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

    if (poolQuestions.length === 0) return showToast("Môn học này chưa có đủ câu hỏi để tiến hành trộn đề.");

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
    if (!nameInput) return showToast("Vui lòng xác nhận Họ và Tên trước khi bắt đầu.");
    
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
    const bSub = document.getElementById('btn-submit'); if(bSub) bSub.classList.toggle('hidden', index !== activeQuiz.questions.length - 1 || isReviewMode);

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
            clearInterval(timerInterval); showToast("Đã hết thời gian làm bài. Hệ thống đang xử lý nộp bài...", false); submitQuiz(true);
        }
    }, 1000);
}

function handleVisibilityChange() {
    if (document.hidden && !isPracticeMode && !isReviewMode && screens.quiz && !screens.quiz.classList.contains('hidden')) {
        if (++tabSwitchCount >= 2) { 
            showToast("Hệ thống phát hiện thao tác rời khỏi màn hình thi 2 lần. Bài thi tự động được nộp."); 
            submitQuiz(true); 
        } else { showToast("Nhắc nhở: Không chuyển sang màn hình khác trong quá trình thi thử."); }
    }
}

function submitQuiz(force) {
    const timeUsed = activeQuiz.timeLimit - (timeLeft > 0 ? timeLeft : 0);
    const minimumTime = Math.floor(activeQuiz.timeLimit / 2);

    if (!force && timeUsed < minimumTime && !isPracticeMode) {
        showToast("Hệ thống từ chối nộp bài. Vui lòng làm bài ít nhất 50% thời gian quy định.");
        return; 
    }

    if (force || confirm("Xác nhận nộp bài thi?")) {
        clearInterval(timerInterval);
        exitFullscreen();
        localStorage.removeItem('quizProgress_' + activeQuiz.id);

        let correctCount = userAnswers.filter((ans, i) => ans === activeQuiz.questions[i].correctAnswer).length;
        const finalTimeUsed = activeQuiz.timeLimit - (timeLeft > 0 ? timeLeft : 0);
        const timeUsedStr = `${Math.floor(finalTimeUsed / 60).toString().padStart(2, '0')}:${(finalTimeUsed % 60).toString().padStart(2, '0')}`;
        const percent = Math.round((correctCount / activeQuiz.questions.length) * 100);

        switchScreen('result');
        const sc = document.getElementById('result-score'); if(sc) sc.innerText = `${correctCount}/${activeQuiz.questions.length}`;
        const pc = document.getElementById('result-percent'); if(pc) pc.innerText = `${percent}%`;
        const tc = document.getElementById('result-time'); 
        if(tc) tc.innerText = isPracticeMode ? "Không giới hạn" : timeUsedStr;

        generateRoadmap(percent);

        const scorePayload = {
            quizId: activeQuiz.id, quizTitle: activeQuiz.title, category: activeQuiz.category,
            studentName: studentName, email: auth.currentUser ? auth.currentUser.email : "Ẩn danh",
            uid: auth.currentUser ? auth.currentUser.uid : null,
            score: `${correctCount}/${activeQuiz.questions.length}`, percentage: percent, timeUsed: isPracticeMode ? "Luyện tập" : timeUsedStr,
            teacherId: activeQuiz.authorId || null, 
            userAnswers: userAnswers, quizQuestionsSnapshot: activeQuiz.questions,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };

        db.collection("results").add(scorePayload).catch(err => console.error("Lỗi cập nhật điểm: ", err));
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
                let optA = match[3].trim(); let optB = match[5].trim(); let optC = match[7].trim(); let optD = match[9].trim();
                let correctIndex = 0; 
                if (match[2].includes('*') || match[2].includes('#')) correctIndex = 0;
                if (match[4].includes('*') || match[4].includes('#')) correctIndex = 1;
                if (match[6].includes('*') || match[6].includes('#')) correctIndex = 2;
                if (match[8].includes('*') || match[8].includes('#')) correctIndex = 3;
                if(optD.toLowerCase().includes("đáp án")) optD = optD.split(/đáp án/i)[0].trim();

                let splitA = optA.split('::'); optA = splitA[0].trim(); let expA = splitA[1] ? splitA[1].trim() : "";
                let splitB = optB.split('::'); optB = splitB[0].trim(); let expB = splitB[1] ? splitB[1].trim() : "";
                let splitC = optC.split('::'); optC = splitC[0].trim(); let expC = splitC[1] ? splitC[1].trim() : "";
                let splitD = optD.split('::'); optD = splitD[0].trim(); let expD = splitD[1] ? splitD[1].trim() : "";

                currentSmartQuestions.push({
                    content: content, options: [optA, optB, optC, optD], optionExplanations: [expA, expB, expC, expD],
                    correctAnswer: correctIndex, explanation: "Tạo tự động từ dữ liệu văn bản.", passage: currentPassage 
                });
                
                const labels = ['A', 'B', 'C', 'D'];
                previewHTML += `
                    <div class="p-3 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-sm">
                        <p class="font-bold text-sm text-gray-800 dark:text-white mb-2">Câu ${currentSmartQuestions.length}: ${content}</p>
                        <div class="grid grid-cols-1 gap-1">
                            ${[optA, optB, optC, optD].map((opt, i) => `
                                <div class="text-xs p-1.5 rounded flex items-start gap-1 ${i === correctIndex ? 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300 font-bold border border-green-200' : 'text-gray-600 dark:text-gray-300'}">
                                    <span class="font-bold w-4">${labels[i]}.</span> 
                                    <div class="flex flex-col">
                                        <span>${opt}</span>
                                        ${[expA, expB, expC, expD][i] ? `<span class="text-[0.65rem] italic mt-0.5 text-gray-500 dark:text-gray-400">Giải thích: ${[expA, expB, expC, expD][i]}</span>` : ''}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
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

function addManualQuestionForm() {
    const container = document.getElementById('manual-questions-container'); if(!container) return;
    const qDiv = document.createElement('div'); qDiv.className = 'manual-q-block p-4 sm:p-6 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl relative';
    qDiv.innerHTML = `
        <button onclick="this.parentElement.remove()" class="absolute top-3 right-3 sm:top-4 sm:right-4 text-gray-400 hover:text-red-500 transition-colors"><i class="fas fa-times text-lg sm:text-xl"></i></button>
        <h4 class="font-bold mb-3 sm:mb-4 dark:text-white text-blue-600 text-sm sm:text-base">Nội dung câu hỏi</h4>
        <div class="mb-3 sm:mb-4">
            <label class="text-xs sm:text-sm font-bold text-gray-500 dark:text-gray-400">Đoạn văn (Bỏ trống nếu không có):</label>
            <textarea placeholder="Nội dung bài đọc..." class="q-passage w-full p-2 sm:p-3 mt-1 border rounded outline-none focus:border-blue-500 dark:bg-gray-800 dark:text-white dark:border-gray-600 text-sm sm:text-base" rows="3"></textarea>
        </div>
        <textarea placeholder="Nội dung câu hỏi chính..." class="q-content w-full p-2 sm:p-3 mb-3 sm:mb-4 border rounded outline-none focus:border-blue-500 dark:bg-gray-800 dark:text-white dark:border-gray-600 text-sm sm:text-base" rows="2"></textarea>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 mb-3 sm:mb-4">
            <input type="text" placeholder="Lựa chọn A" class="q-opt-0 p-2 border rounded dark:bg-gray-800 dark:text-white dark:border-gray-600 outline-none text-sm sm:text-base">
            <input type="text" placeholder="Lựa chọn B" class="q-opt-1 p-2 border rounded dark:bg-gray-800 dark:text-white dark:border-gray-600 outline-none text-sm sm:text-base">
            <input type="text" placeholder="Lựa chọn C" class="q-opt-2 p-2 border rounded dark:bg-gray-800 dark:text-white dark:border-gray-600 outline-none text-sm sm:text-base">
            <input type="text" placeholder="Lựa chọn D" class="q-opt-3 p-2 border rounded dark:bg-gray-800 dark:text-white dark:border-gray-600 outline-none text-sm sm:text-base">
        </div>
        <div class="flex flex-col sm:flex-row gap-2 sm:gap-4 items-start sm:items-center">
            <label class="font-bold dark:text-gray-300 text-sm sm:text-base">Đáp án đúng:</label>
            <select class="q-correct p-2 border rounded outline-none dark:bg-gray-800 dark:text-white dark:border-gray-600 w-full sm:w-auto text-sm sm:text-base"><option value="0">A</option><option value="1">B</option><option value="2">C</option><option value="3">D</option></select>
        </div>
        <input type="text" placeholder="Giải thích chi tiết (Tùy chọn)..." class="q-expl w-full p-2 mt-3 sm:mt-4 border rounded outline-none dark:bg-gray-800 dark:text-white dark:border-gray-600 text-sm sm:text-base">
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
        const opts = [block.querySelector('.q-opt-0').value.trim(), block.querySelector('.q-opt-1').value.trim(), block.querySelector('.q-opt-2').value.trim(), block.querySelector('.q-opt-3').value.trim()];
        const correct = parseInt(block.querySelector('.q-correct').value); const expl = block.querySelector('.q-expl').value.trim() || "Chưa có giải thích.";
        if (!content || opts.some(o => o === "")) isValid = false;
        questions.push({ passage: passage, content: content, options: opts, correctAnswer: correct, explanation: expl });
    });

    if (!isValid) return alert("Vui lòng hoàn thiện nội dung câu hỏi và 4 lựa chọn.");
    const newQuiz = { id: "QZ-MANUAL-" + Date.now(), title: title, category: category, timeLimit: timeLimit, questions: questions, isTestOnly: isTestOnly, authorId: auth.currentUser ? auth.currentUser.uid : "GUEST" };

    db.collection("quizzes").doc(newQuiz.id).set(newQuiz).then(() => {
        alert("Lưu thông tin thành công."); if(titleEl) titleEl.value = ''; if(catEl) catEl.value = ''; if(timeEl) timeEl.value = ''; if(testEl) testEl.checked = false;
        const mc = document.getElementById('manual-questions-container'); if(mc) mc.innerHTML = '';
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

function updatePlanBadge() {
    const homeBadge = document.getElementById('home-plan-badge');
    const quizBadge = document.getElementById('quiz-plan-badge');
    let badgeHTML = '';
    
    switch(currentPlan) {
        case 'plus':
            badgeHTML = `<span class="badge-pill badge-bronze" title="Gói Plus"><i class="fas fa-medal mr-1.5"></i> Plus</span>`;
            break;
        case 'pro':
            badgeHTML = `<span class="badge-pill badge-silver" title="Gói Pro"><i class="fas fa-shield-alt mr-1.5"></i> Pro</span>`;
            break;
        case 'ultra':
            badgeHTML = `<span class="badge-pill badge-gold" title="Gói Ultra"><i class="fas fa-crown mr-1.5"></i> Ultra</span>`;
            break;
        default:
            badgeHTML = `<span class="badge-pill badge-basic" title="Gói Cơ Bản"><i class="fas fa-user mr-1.5"></i> Cơ bản</span>`;
    }

    if (homeBadge) homeBadge.innerHTML = badgeHTML;
    if (quizBadge) quizBadge.innerHTML = badgeHTML;
}

// BẢNG LỘ TRÌNH ĐÁNH GIÁ (ROADMAP) VÀ DỰ ĐOÁN ĐIỂM SỐ
function generateRoadmap(percent) {
    const container = document.getElementById('roadmap-container');
    const content = document.getElementById('roadmap-content');
    if(!container || !content) return;

    container.classList.add('hidden');

    if(!checkFeatureAccess('roadmap', true)) {
        content.innerHTML = `<p class="text-center text-gray-500 italic py-4"><i class="fas fa-lock"></i> Nội dung phân tích yêu cầu tài khoản được nâng cấp. <a href="#" onclick="switchScreen('pricing')" class="text-blue-600 font-bold underline">Xem chi tiết gói cước</a>.</p>`;
        return;
    }

    let html = "";
    let predictedScore = (percent / 10).toFixed(1); 
    let scoreBadgeClass = percent >= 80 ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border-green-300 dark:border-green-700' : 
                          percent >= 50 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700' : 
                                          'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 border-red-300 dark:border-red-700';
                                          
    html += `
        <div class="mb-5 p-4 sm:p-5 ${scoreBadgeClass} border-2 rounded-xl flex items-center justify-between shadow-sm">
            <div>
                <p class="text-sm sm:text-base font-bold uppercase tracking-wider mb-1"><i class="fas fa-bullseye mr-1"></i> Điểm Số Ước Tính</p>
                <p class="text-xs sm:text-sm opacity-80 font-medium">Căn cứ theo tỷ lệ hoàn thành bài thi</p>
            </div>
            <div class="text-3xl sm:text-4xl font-black font-mono">${predictedScore} <span class="text-base sm:text-lg font-medium opacity-80">/ 10</span></div>
        </div>
    `;

    if (percent < 50) {
        html += `<p><i class="fas fa-times-circle text-red-500 text-lg mr-2"></i><strong>Đánh giá chung:</strong> Kiến thức cơ bản cần được củng cố thêm.</p>
                <p class="pl-7 mt-2"><i class="fas fa-arrow-right text-blue-500 mr-2"></i><strong>Khuyến nghị 1:</strong> Sử dụng tính năng xem Giải thích chi tiết cho các câu trả lời sai.</p>
                <p class="pl-7 mt-2"><i class="fas fa-arrow-right text-blue-500 mr-2"></i><strong>Khuyến nghị 2:</strong> Thực hiện lại đề thi này thông qua chức năng "Vá lỗi sai" trong lịch sử.</p>`;
    } else if (percent < 80) {
        html += `<p><i class="fas fa-exclamation-circle text-amber-500 text-lg mr-2"></i><strong>Đánh giá chung:</strong> Nắm vững trọng tâm nhưng cần lưu ý các dạng câu hỏi phân loại.</p>
                <p class="pl-7 mt-2"><i class="fas fa-arrow-right text-blue-500 mr-2"></i><strong>Khuyến nghị 1:</strong> Sử dụng công cụ Highlight để phân tích kỹ từ khóa trong câu hỏi.</p>
                <p class="pl-7 mt-2"><i class="fas fa-arrow-right text-blue-500 mr-2"></i><strong>Khuyến nghị 2:</strong> Áp dụng chức năng "Trộn Câu Sai" để khắc phục các lỗi thường gặp.</p>`;
    } else {
        html += `<p><i class="fas fa-check-circle text-green-500 text-lg mr-2"></i><strong>Đánh giá chung:</strong> Kết quả xuất sắc, kiến thức được vận dụng tốt.</p>
                <p class="pl-7 mt-2"><i class="fas fa-arrow-right text-blue-500 mr-2"></i><strong>Khuyến nghị 1:</strong> Tiếp tục thực hành với các bài "Thi thử tổng hợp" để rèn luyện kỹ năng quản lý thời gian.</p>
                <p class="pl-7 mt-2"><i class="fas fa-arrow-right text-blue-500 mr-2"></i><strong>Khuyến nghị 2:</strong> Mở rộng phạm vi ôn tập sang các chuyên đề khác.</p>`;
    }
    content.innerHTML = html;
}

// ĐÀI QUAN SÁT NĂNG LỰC TOÀN MÔN (GÓI PRO)
window.generateSubjectAnalysis = function() {
    if (!checkIsMasterAdmin() && currentPlan !== 'pro' && currentPlan !== 'ultra') {
        showToast("Tính năng Phân Tích Năng Lực yêu cầu tài khoản cấp độ Pro trở lên.", true);
        switchScreen('pricing');
        return;
    }

    if (!currentSelectedCategory) return showToast("Hệ thống chưa xác định được môn học hiện tại.", true);

    showToast("Đang phân tích dữ liệu môn học...", false);

    db.collection("results")
        .where("uid", "==", auth.currentUser.uid)
        .where("category", "==", currentSelectedCategory)
        .get()
        .then(snapshot => {
            if(snapshot.empty) {
                return showToast("Hệ thống chưa ghi nhận dữ liệu làm bài để tiến hành phân tích.", true);
            }

            let chapterStats = {};
            
            snapshot.forEach(doc => {
                let data = doc.data();
                if (data.quizId.startsWith("MOCK-") || data.quizId.startsWith("ERROR-")) return;
                
                let title = data.quizTitle;
                if(!chapterStats[title]) {
                    chapterStats[title] = { totalPercent: 0, count: 0 };
                }
                chapterStats[title].totalPercent += data.percentage;
                chapterStats[title].count += 1;
            });

            let chapters = Object.keys(chapterStats);
            if(chapters.length === 0) {
                return showToast("Cần hoàn thành ít nhất 1 bài tập theo chương để sử dụng chức năng này.", true);
            }

            let totalSubjectPercent = 0;
            let processedChapters = [];
            
            chapters.forEach(ch => {
                let avg = Math.round(chapterStats[ch].totalPercent / chapterStats[ch].count);
                totalSubjectPercent += avg;
                processedChapters.push({ name: ch, avg: avg });
            });

            let overallPercent = Math.round(totalSubjectPercent / chapters.length);
            let predictedScore = (overallPercent / 10).toFixed(1);

            processedChapters.sort((a, b) => a.avg - b.avg);
            let weakest = processedChapters[0];
            let strongest = processedChapters[processedChapters.length - 1];

            document.getElementById('analysis-subject-name').innerText = currentSelectedCategory;
            
            let adviceHTML = "";
            if (overallPercent < 50) {
                adviceHTML = 'Mức độ nắm bắt kiến thức chung đang khá thấp. Khuyến nghị ôn tập lại các lý thuyết nền tảng trước khi làm bài tập nâng cao.';
            } else if (overallPercent < 80) {
                adviceHTML = 'Cơ sở kiến thức tương đối ổn định. Khuyến nghị tăng cường cường độ thực hành qua các bài Thi Thử Tổng Hợp.';
            } else {
                adviceHTML = 'Kết quả tổng quan rất tích cực. Khuyến nghị duy trì nhịp độ ôn tập định kỳ để bảo toàn lượng kiến thức đã học.';
            }

            let contentHTML = `
                <div class="grid grid-cols-2 gap-4 mb-6">
                    <div class="bg-blue-50 dark:bg-gray-700/50 p-4 rounded-2xl text-center border border-blue-100 dark:border-gray-600 shadow-sm">
                        <p class="text-xs sm:text-sm text-gray-500 dark:text-gray-400 font-bold mb-1 uppercase tracking-wider">Điểm Dự Đoán</p>
                        <p class="text-4xl font-black text-blue-700 dark:text-blue-400 font-mono">${predictedScore}</p>
                    </div>
                    <div class="bg-indigo-50 dark:bg-gray-700/50 p-4 rounded-2xl text-center border border-indigo-100 dark:border-gray-600 shadow-sm">
                        <p class="text-xs sm:text-sm text-gray-500 dark:text-gray-400 font-bold mb-1 uppercase tracking-wider">Phạm Vi Ôn Tập</p>
                        <p class="text-4xl font-black text-indigo-700 dark:text-indigo-400 font-mono">${chapters.length} <span class="text-sm font-medium text-gray-500">chương</span></p>
                    </div>
                </div>
                
                <div class="space-y-3 mb-6">
                    <div class="p-4 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800 flex justify-between items-center">
                        <div>
                            <p class="text-[0.7rem] font-bold text-red-800 dark:text-red-400 mb-0.5 uppercase"><i class="fas fa-exclamation-triangle mr-1"></i> Trọng điểm cần khắc phục</p>
                            <p class="font-bold text-gray-800 dark:text-gray-200 text-sm sm:text-base">${weakest.name}</p>
                        </div>
                        <span class="font-mono text-xl font-black text-red-600 dark:text-red-400 bg-white dark:bg-gray-800 px-3 py-1 rounded-lg shadow-sm border border-red-100 dark:border-red-800">${weakest.avg}%</span>
                    </div>
                    
                    <div class="p-4 bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-200 dark:border-green-800 flex justify-between items-center">
                        <div>
                            <p class="text-[0.7rem] font-bold text-green-800 dark:text-green-400 mb-0.5 uppercase"><i class="fas fa-medal mr-1"></i> Chương đạt kết quả tốt nhất</p>
                            <p class="font-bold text-gray-800 dark:text-gray-200 text-sm sm:text-base">${strongest.name}</p>
                        </div>
                        <span class="font-mono text-xl font-black text-green-600 dark:text-green-400 bg-white dark:bg-gray-800 px-3 py-1 rounded-lg shadow-sm border border-green-100 dark:border-green-800">${strongest.avg}%</span>
                    </div>
                </div>

                <div class="p-5 bg-gray-50 dark:bg-gray-700/30 rounded-xl border border-gray-200 dark:border-gray-600 text-sm sm:text-base leading-relaxed text-gray-700 dark:text-gray-300 shadow-inner">
                    <p class="font-bold mb-3 text-gray-900 dark:text-white flex items-center gap-2"><i class="fas fa-map-signs text-indigo-500"></i> Hướng Dẫn Ôn Tập:</p>
                    <ul class="list-disc pl-5 space-y-2 font-medium">
                        <li>Khuyến nghị ưu tiên sử dụng chức năng <strong>Trộn Câu Sai</strong> để củng cố chuyên đề <strong class="text-red-600 dark:text-red-400">${weakest.name}</strong>.</li>
                        <li>${adviceHTML}</li>
                    </ul>
                </div>
            `;

            document.getElementById('analysis-content').innerHTML = contentHTML;
            document.getElementById('analysis-modal').classList.remove('hidden');

        }).catch(err => showToast("Lỗi xử lý dữ liệu: " + err.message, true));
}
