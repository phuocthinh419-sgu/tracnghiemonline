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
// [VIP] NGỌC TỶ TRUYỀN QUỐC (MASTER ADMIN)
// =========================================================================
// Bệ hạ hãy dán UID tài khoản của mình vào đây (Bấm F12 -> Console -> Gõ: auth.currentUser.uid)
const MASTER_ADMIN_UID = "DÁN_UID_CỦA_BỆ_HẠ_VÀO_ĐÂY";

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

// [VIP BỘ BIẾN QUẢN LÝ GÓI CƯỚC]
let currentPlan = 'basic';
let mockGeneratedThisMonth = 0;
let lastMockMonth = null;

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

            // [VIP] NẠP ẤN TÍN TÀI KHOẢN (PLAN) TỪ FIREBASE VÀ BẮT BUỘC LƯU EMAIL
            db.collection("users").doc(user.uid).get().then(doc => {
                if(doc.exists) {
                    currentPlan = doc.data().plan || 'basic';
                    mockGeneratedThisMonth = doc.data().mockGeneratedThisMonth || 0;
                    lastMockMonth = doc.data().lastMockMonth || null;
                    
                    // Cập nhật lại Email đề phòng sĩ tử đổi Email
                    db.collection("users").doc(user.uid).update({ email: user.email.toLowerCase() });
                    
                    // Reset bộ đếm nếu đã qua tháng mới
                    let currentMonth = new Date().getMonth();
                    if(lastMockMonth !== currentMonth) {
                        mockGeneratedThisMonth = 0;
                        lastMockMonth = currentMonth;
                        db.collection("users").doc(user.uid).update({mockGeneratedThisMonth: 0, lastMockMonth: currentMonth});
                    }
                } else {
                    // Dân thường mới đăng ký sẽ nhận gói Basic mặc định và được lưu Email
                    db.collection("users").doc(user.uid).set({
                        email: user.email.toLowerCase(), // Lưu Email để Bệ hạ tìm kiếm
                        plan: 'basic',
                        mockGeneratedThisMonth: 0,
                        lastMockMonth: new Date().getMonth()
                    });
                    currentPlan = 'basic';
                }
            });

            const urlParams = new URLSearchParams(window.location.search);
            const quizIdParam = urlParams.get('quiz');
            if (quizIdParam) {
                checkUrlForSharedQuiz(quizIdParam);
            } else {
                switchScreen('home'); 
            }
        } else {
            switchScreen('auth');
            toggleAuthMode(true); 
        }
    });
});

// --- [VIP] TRẬN PHÁP KIỂM TRA QUYỀN LỢI ĐĂNG KÝ ---
function checkFeatureAccess(feature, silent = false) {
    if (checkIsMasterAdmin()) return true; // Bệ hạ dùng full toàn bộ chức năng, không giới hạn

    const plans = {
        'basic': ['highlight', 'fullscreen'],
        'plus': ['highlight', 'fullscreen', 'explanation', 'autosave', 'roadmap', 'adaptive'],
        'pro': ['highlight', 'fullscreen', 'explanation', 'autosave', 'roadmap', 'adaptive', 'crossout', 'error_correction'],
        'ultra': ['highlight', 'fullscreen', 'explanation', 'autosave', 'roadmap', 'adaptive', 'crossout', 'error_correction', 'infinite_mock']
    };

    const userFeatures = plans[currentPlan] || plans['basic'];
    
    if (!userFeatures.includes(feature)) {
        if(!silent) {
            alert("Tính năng này đã bị khóa. Vui lòng nâng cấp Gói Đăng Ký để sử dụng!");
            switchScreen('pricing');
        }
        return false;
    }
    return true;
}

// Lưu Tiến Độ Học Tập (Local Storage)
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
    }, (error) => { console.error("Lỗi khi tải dữ liệu: ", error); });
}

function checkUrlForSharedQuiz(quizId) {
    db.collection("quizzes").doc(quizId).get().then((doc) => {
        if (doc.exists) {
            activeQuiz = doc.data(); prepareWelcomeScreen();
        } else {
            alert("Đề thi này không tồn tại hoặc đã bị gỡ bỏ khỏi hệ thống!"); switchScreen('home');
        }
        window.history.replaceState({}, document.title, window.location.pathname);
    }).catch(err => { console.error("Lỗi link: ", err); switchScreen('home'); });
}

function copyLink(link) {
    navigator.clipboard.writeText(link).then(() => { alert("Đã sao chép liên kết thành công! Bạn có thể dán để gửi cho học sinh."); });
}

// --- 4. CẤU HÌNH SỰ KIỆN GIAO DIỆN ---
function setupEventListeners() {
    const addEvt = (id, event, handler) => { const el = document.getElementById(id); if (el) el.addEventListener(event, handler); };

    addEvt('btn-auth-toggle', 'click', () => toggleAuthMode(!isLoginMode));
    addEvt('btn-auth-submit', 'click', handleAuthSubmit);
    addEvt('btn-logout', 'click', () => { if(confirm("Đăng xuất tài khoản?")) auth.signOut(); });
    addEvt('role-student', 'click', () => setRole('student'));
    addEvt('role-teacher', 'click', () => setRole('teacher'));
    addEvt('btn-theme-toggle', 'click', toggleDarkMode);
    addEvt('btn-show-admin', 'click', () => switchScreen('admin'));
    
    const goHome = () => { window.history.pushState({}, '', window.location.pathname); switchScreen('home'); };
    addEvt('btn-back-to-home', 'click', goHome);
    addEvt('btn-back-to-subject', 'click', () => switchScreen('subjectDetail'));
    addEvt('btn-home', 'click', goHome);
    
    addEvt('btn-exit-quiz', 'click', () => {
        if (confirm("Thoát? Tiến trình làm bài sẽ được tự động lưu (Nếu là hội viên).")) {
            clearInterval(timerInterval); 
            exitFullscreen(); // Thoát chế độ khóa màn hình
            saveProgressLocally(); // Lưu trước khi thoát
            switchScreen('subjectDetail');
        }
    });

    addEvt('btn-start-mock-generate', 'click', generateSubjectMockTest);
    addEvt('btn-practice', 'click', () => startQuiz(true));
    addEvt('btn-mock', 'click', () => startQuiz(false));
    addEvt('btn-prev', 'click', () => loadQuestion(currentQuestionIndex - 1));
    addEvt('btn-next', 'click', () => loadQuestion(currentQuestionIndex + 1));
    addEvt('btn-submit', 'click', () => submitQuiz(false));
    addEvt('btn-review', 'click', reviewQuiz);
    addEvt('btn-hint', 'click', () => {
        const hintBox = document.getElementById('hint-box');
        if(hintBox) hintBox.classList.remove('hidden');
    });
    addEvt('btn-flag', 'click', toggleFlag);
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
    if (!email || !password) return alert("Nhập đủ Email và Mật khẩu!");
    if (isLoginMode) { auth.signInWithEmailAndPassword(email, password).catch(err => alert("Đăng nhập thất bại: " + err.message)); } 
    else {
        if (!name) return alert("Nhập Họ và tên để tạo hồ sơ!");
        auth.createUserWithEmailAndPassword(email, password).then((result) => { return result.user.updateProfile({ displayName: name }); })
        .then(() => { alert("Đăng ký thành công!"); auth.currentUser.reload(); }).catch(err => alert("Lỗi đăng ký: " + err.message));
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
        
        // [VIP] CHỈ HIỆN NÚT QUẢN TRỊ NẾU ĐÚNG LÀ BỆ HẠ
        if(btnAdmin) {
            if (checkIsMasterAdmin()) {
                btnAdmin.classList.remove('hidden');
            } else {
                btnAdmin.classList.add('hidden');
                alert("To gan! Bạn không có quyền truy cập vào Khu Vực Quản Trị của Hệ thống!");
                setTimeout(() => setRole('student'), 100); // Đuổi về làm học sinh ngay lập tức
                return;
            }
        }
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
    // [VIP] CẢN BƯỚC KẺ GIAN DÙNG LỆNH JAVASCRIPT ĐỂ XUYÊN THỦNG VÀO ADMIN ZONE
    if (screenName === 'admin' && !checkIsMasterAdmin()) {
        alert("Cảnh báo: Bạn không có quyền truy cập Nội Cung!");
        return;
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
    }
}

// --- 5. RENDER DANH SÁCH TRANG CHỦ & LỊCH SỬ KHO ---
function renderHomeQuizList() {
    const container = document.getElementById('quiz-list-container');
    if(!container) return;
    container.innerHTML = '';
    
    if (currentRole === 'teacher' || currentStudentTab === 'browse') {
        if (quizDatabase.length === 0) {
            container.innerHTML = '<p class="col-span-full text-center text-gray-500 py-8">Chưa có dữ liệu môn học nào do bạn quản lý.</p>';
            return;
        }

        const categories = [...new Set(quizDatabase.map(q => q.category))];
        categories.forEach(category => {
            const totalQuizzes = quizDatabase.filter(q => q.category === category).length;
            const card = document.createElement('div');
            card.className = 'p-6 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-2xl shadow-sm hover:shadow-xl transition-all cursor-pointer flex items-center justify-between group';
            card.innerHTML = `
                <div class="flex items-center gap-4">
                    <div class="w-14 h-14 bg-blue-50 dark:bg-gray-800 text-blue-900 dark:text-blue-400 rounded-xl flex items-center justify-center text-2xl group-hover:bg-blue-900 group-hover:text-white transition-colors">
                        <i class="fas fa-folder"></i>
                    </div>
                    <div>
                        <h3 class="text-xl font-bold text-gray-800 dark:text-white group-hover:text-blue-900 dark:group-hover:text-blue-400 transition-colors">${category}</h3>
                        <p class="text-sm text-gray-400 mt-1">Gồm có ${totalQuizzes} bộ đề / chương</p>
                    </div>
                </div>
                <div class="text-gray-300 group-hover:text-blue-900 dark:group-hover:text-blue-400 transition-colors"><i class="fas fa-chevron-right text-xl"></i></div>
            `;
            card.onclick = () => { currentSelectedCategory = category; switchScreen('subjectDetail'); };
            container.appendChild(card);
        });
    } 
    else if (currentRole === 'student' && currentStudentTab === 'history') {
        if (!auth.currentUser) return;
        container.innerHTML = '<p class="col-span-full text-center text-gray-500 py-4">Đang kết nối tải tệp đề đã làm...</p>';
        
        db.collection("results").where("uid", "==", auth.currentUser.uid).get().then((snapshot) => {
            container.innerHTML = '';
            if (snapshot.empty) {
                container.innerHTML = '<p class="col-span-full text-center text-gray-500 py-8">Kho trống. Bạn chưa thực hiện bài thi nào.</p>'; return;
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
                
                let isMock = res.quizId.startsWith("MOCK-GENERATED-") || res.quizId.startsWith("ERROR-CORRECTION-");
                let actionBtnHTML = isMock ? '' : `<button onclick="redoQuizFromHistory('${res.quizId}')" class="px-3 py-1.5 bg-blue-900 text-white text-xs font-bold rounded-lg hover:bg-blue-800 transition-colors"><i class="fas fa-redo mr-1"></i>Làm lại</button>`;
                let reviewBtnHTML = `<button onclick="reviewPastQuiz('${res.quizId}', '${item.id}')" class="px-3 py-1.5 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700 transition-colors mr-2"><i class="fas fa-eye mr-1"></i>Xem bài</button>`;
                
                // [VIP] NÚT VÁ LỖ HỔNG DÀNH CHO GÓI PRO & ULTRA
                let errorBtnHTML = `<button onclick="generateErrorCorrection('${item.id}')" class="px-3 py-1.5 bg-orange-500 text-white text-xs font-bold rounded-lg hover:bg-orange-600 transition-colors mr-2"><i class="fas fa-tools mr-1"></i>Vá lỗi sai</button>`;

                card.innerHTML = `
                    <button onclick="deleteHistoryEntry('${item.id}')" class="absolute top-4 right-4 text-gray-400 hover:text-red-500 bg-gray-50 dark:bg-gray-800 rounded-full w-8 h-8 flex items-center justify-center shadow-sm transition-colors" title="Xóa lịch sử này"><i class="fas fa-times"></i></button>
                    <div>
                        <span class="text-[0.7rem] px-2 py-0.5 bg-purple-50 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300 rounded-full font-bold border dark:border-purple-800">${res.category}</span>
                        <h3 class="text-base font-bold text-gray-800 dark:text-white mt-2 pr-6 line-clamp-2">${res.quizTitle}</h3>
                        <p class="text-[0.7rem] text-gray-400 mt-1"><i class="far fa-clock"></i> Nộp: ${formatStr}</p>
                        
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
        }).catch(err => { container.innerHTML = '<p class="col-span-full text-center text-red-500 py-4">Lỗi kết nối tệp điểm đám mây.</p>'; });
    }
}

function redoQuizFromHistory(quizId) {
    db.collection("quizzes").doc(quizId).get().then((doc) => {
        if (doc.exists) { activeQuiz = doc.data(); prepareWelcomeScreen(); } 
        else { alert("Đề thi này đã bị Giáo viên xóa hoặc không còn tồn tại trên hệ thống!"); }
    }).catch(err => alert("Lỗi khi tải đề thi: " + err.message));
}

// [VIP] HÀM TẠO ĐỀ TỪ CÂU LÀM SAI (GÓI PRO & ULTRA)
window.generateErrorCorrection = function(resultDocId) {
    if(!checkFeatureAccess('error_correction')) return; 
    
    db.collection("results").doc(resultDocId).get().then((resDoc) => {
        if (resDoc.exists) {
            const pastData = resDoc.data();
            if (!pastData.quizQuestionsSnapshot) return alert("Dữ liệu cũ không hỗ trợ tính năng này do thiếu Snapshot Đề gốc!");
            
            let wrongQuestions = [];
            pastData.userAnswers.forEach((ans, idx) => {
                if (ans !== pastData.quizQuestionsSnapshot[idx].correctAnswer) {
                    wrongQuestions.push(pastData.quizQuestionsSnapshot[idx]);
                }
            });

            if (wrongQuestions.length === 0) return alert("Thật xuất sắc! Bạn không làm sai câu nào trong đề này để phải vá lỗi.");

            activeQuiz = {
                id: "ERROR-CORRECTION-" + Date.now(),
                title: `[Vá Lỗ Hổng] - ` + pastData.quizTitle,
                category: pastData.category,
                timeLimit: wrongQuestions.length * 60, 
                questions: wrongQuestions,
                isTestOnly: false,
                authorId: auth.currentUser ? auth.currentUser.uid : "GUEST"
            };
            
            prepareWelcomeScreen();
        }
    });
}

function reviewPastQuiz(quizId, resultDocId) {
    db.collection("quizzes").doc(quizId).get().then((quizDoc) => {
        if (!quizDoc.exists) return alert("Đề thi gốc này đã bị Giáo viên xóa hoặc gỡ bỏ!");
        activeQuiz = quizDoc.data();
        
        db.collection("results").doc(resultDocId).get().then((resDoc) => {
            if (resDoc.exists) {
                const pastData = resDoc.data();
                if (pastData.quizQuestionsSnapshot) activeQuiz.questions = pastData.quizQuestionsSnapshot;

                userAnswers = pastData.userAnswers || new Array(activeQuiz.questions.length).fill(null);
                flaggedQuestions = new Array(activeQuiz.questions.length).fill(false);
                
                isReviewMode = true; isPracticeMode = false;
                
                const dName = document.getElementById('display-student-name'); if(dName) dName.innerText = pastData.studentName + " (Chế độ xem lại)";
                const qTitle = document.getElementById('quiz-header-title'); if(qTitle) qTitle.innerText = activeQuiz.title;
                
                switchScreen('quiz');
                const eb = document.getElementById('energy-bar-container'); if(eb) eb.classList.add('hidden');
                const bs = document.getElementById('btn-submit'); if(bs) bs.classList.add('hidden');
                
                currentFilter = 'all';
                const fp = document.getElementById('filter-tabs-practice'); if(fp) fp.classList.replace('grid', 'hidden');
                const fr = document.getElementById('filter-tabs-review'); if(fr) fr.classList.replace('hidden', 'grid');
                resetFilterButtons(fr);
                loadQuestion(0);
            }
        });
    }).catch(err => alert("Lỗi tải tệp: " + err.message));
}

function deleteHistoryEntry(docId) {
    if (confirm("Xóa lịch sử này khỏi Kho Đã Làm? Đề gốc sẽ không bị ảnh hưởng.")) {
        db.collection("results").doc(docId).delete().then(() => { renderHomeQuizList(); }).catch(err => alert("Lỗi xóa: " + err.message));
    }
}

function renderSubjectDetailView(category) {
    const titleEl = document.getElementById('subject-detail-title'); if(titleEl) titleEl.innerText = "Môn học: " + category;
    const container = document.getElementById('chapter-list-container'); if(!container) return;
    container.innerHTML = '';

    const quizzesInFolder = quizDatabase.filter(q => q.category === category);
    if(quizzesInFolder.length === 0) {
        container.innerHTML = '<p class="col-span-full text-center text-gray-500 py-4">Thư mục môn học này hiện đang trống.</p>'; return;
    }

    quizzesInFolder.forEach(quiz => {
        const card = document.createElement('div');
        card.className = 'relative p-6 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-2xl shadow-sm hover:shadow-lg transition-all group';
        
        let actionBtnsHTML = '';
        let badgeHTML = quiz.isTestOnly ? 
            '<span class="px-3 py-1 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs font-bold rounded-full border dark:border-red-800">Đề Kiểm Tra</span>' : 
            '<span class="px-3 py-1 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-xs font-bold rounded-full border dark:border-gray-500">Đề bài lẻ</span>';

        if (checkIsMasterAdmin()) {
            const shareLink = `${window.location.origin}${window.location.pathname}?quiz=${quiz.id}`;
            actionBtnsHTML = `
                <button onclick="copyLink('${shareLink}')" class="absolute top-4 right-14 text-gray-400 hover:text-blue-500 transition-colors bg-gray-100 dark:bg-gray-800 rounded-full w-8 h-8 flex items-center justify-center shadow-sm" title="Copy Link"><i class="fas fa-link"></i></button>
                <button onclick="deleteQuiz('${quiz.id}')" class="absolute top-4 right-4 text-gray-400 hover:text-red-500 transition-colors bg-gray-100 dark:bg-gray-800 rounded-full w-8 h-8 flex items-center justify-center shadow-sm" title="Xóa đề"><i class="fas fa-trash-alt"></i></button>
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
    if (!activeQuiz) return alert("Đề thi này không tồn tại!");
    prepareWelcomeScreen();
}

function deleteQuiz(quizId) {
    if (confirm("Xóa vĩnh viễn đề thi này khỏi hệ thống?")) {
        db.collection("quizzes").doc(quizId).delete().then(() => { renderSubjectDetailView(currentSelectedCategory); }).catch(err => alert("Lỗi khi xóa dữ liệu: " + err));
    }
}

// [VIP] KIỂM SOÁT LƯỢT TẠO ĐỀ THÍCH ỨNG / MOCK TEST
function generateSubjectMockTest() {
    let limit = 0;
    if(currentPlan === 'basic') limit = 0;
    else if(currentPlan === 'plus') limit = 3;
    else if(currentPlan === 'pro') limit = 15;
    else limit = 999999; 

    if(!checkIsMasterAdmin() && mockGeneratedThisMonth >= limit) {
        alert(`Bạn đã dùng hết ${mockGeneratedThisMonth}/${limit} lượt tạo đề trong tháng này. Vui lòng nâng cấp gói cước cao hơn để tiếp tục cày cuốc!`);
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

    if (poolQuestions.length === 0) return alert("Môn này chưa có câu hỏi để trộn đề!");

    let currentIndex = poolQuestions.length, randomIndex;
    while (currentIndex != 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        [poolQuestions[currentIndex], poolQuestions[randomIndex]] = [poolQuestions[randomIndex], poolQuestions[currentIndex]];
    }

    const finalCount = Math.min(countSelect, poolQuestions.length);
    const slicedQuestions = poolQuestions.slice(0, finalCount);

    if(finalCount < countSelect) alert(`Chỉ gom được tối đa ${poolQuestions.length} câu.`);

    activeQuiz = {
        id: "MOCK-GENERATED-" + Date.now(),
        title: `Đề Tổng Hợp / Thích Ứng Môn ${currentSelectedCategory}`,
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
    if (!nameInput) return alert("Vui lòng nhập họ và tên trước khi bắt đầu!");
    
    studentName = nameInput; isPracticeMode = practice; isReviewMode = false; tabSwitchCount = 0;
    activeQuiz = JSON.parse(JSON.stringify(activeQuiz));

    let shouldLoadSaved = false;
    if (checkFeatureAccess('autosave', true)) {
        const savedData = localStorage.getItem('quizProgress_' + activeQuiz.id);
        if (savedData) {
            if (confirm("Hệ thống tìm thấy tiến độ làm bài đang dang dở của bạn trong đề này. Bạn có muốn phục hồi và làm tiếp không?")) {
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

    // [VIP] THIẾT QUÂN LUẬT (ÉP FULL-SCREEN KHI THI THỬ) VÀ CẮT THỜI GIAN KHI LUYỆN TẬP
    if (!isPracticeMode) {
        enterFullscreen();
        startTimer();
    } else {
        const timeText = document.getElementById('time-text');
        if (timeText) timeText.innerText = "Vô hạn";
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

// --- HÀM RENDER TRƯỜNG THI ---
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

        q.options.forEach((optText, optIndex) => {
            const btn = document.createElement('button');
            let optExpText = (q.optionExplanations && q.optionExplanations[optIndex]) ? q.optionExplanations[optIndex] : "";
            let expBlock = ''; let labelBg = 'bg-gray-100'; let labelText = 'text-gray-500';
            let btnBorder = 'border-gray-200 dark:border-gray-600'; let btnBg = 'bg-white dark:bg-gray-800';

            if (isAnswerRevealed) {
                btn.style.pointerEvents = 'none';
                if (optIndex === q.correctAnswer) {
                    btnBorder = 'border-green-500'; btnBg = 'bg-green-50 dark:bg-green-900/20'; labelBg = 'bg-green-500'; labelText = 'text-white';
                    if (optExpText) {
                        expBlock = `<div class="mt-3 pl-11 sm:pl-14 text-sm text-green-700 dark:text-green-400 text-left">
                            <div class="font-bold mb-1"><i class="fas fa-check mr-1"></i> Câu trả lời chính xác</div>
                            <div class="font-academic leading-relaxed opacity-90">${optExpText}</div>
                        </div>`;
                    }
                } else if (optIndex === userAnswers[index]) {
                    btnBorder = 'border-red-500'; btnBg = 'bg-red-50 dark:bg-red-900/20'; labelBg = 'bg-red-500'; labelText = 'text-white';
                    if (optExpText) {
                        expBlock = `<div class="mt-3 pl-11 sm:pl-14 text-sm text-red-700 dark:text-red-400 text-left">
                            <div class="font-bold mb-1"><i class="fas fa-times mr-1"></i> Chưa đúng lắm!</div>
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
                if(eText) eText.innerHTML = `<span class="text-gray-500 italic"><i class="fas fa-lock"></i> Lời giải thích đã bị khóa trong Gói Basic. <a href="#" onclick="switchScreen('pricing')" class="text-blue-600 font-bold underline">Nâng Cấp Gói Cước</a> để mở khóa.</span>`;
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
            clearInterval(timerInterval); alert("Hết giờ làm bài! Tự động nộp bài."); submitQuiz(true);
        }
    }, 1000);
}

function handleVisibilityChange() {
    if (document.hidden && !isPracticeMode && !isReviewMode && screens.quiz && !screens.quiz.classList.contains('hidden')) {
        if (++tabSwitchCount >= 2) { 
            alert("CẢNH BÁO VI PHẠM: Thoát trình duyệt 2 lần, tự động thu bài!"); 
            submitQuiz(true); 
        } else { alert("NHẮC NHỞ: Không được chuyển tab khi đang thi thử!"); }
    }
}

function submitQuiz(force) {
    const timeUsed = activeQuiz.timeLimit - (timeLeft > 0 ? timeLeft : 0);
    const minimumTime = Math.floor(activeQuiz.timeLimit / 2);

    if (!force && timeUsed < minimumTime && !isPracticeMode) {
        alert("Cảnh báo từ hệ thống: Yêu cầu nộp bài bị từ chối. Thời gian làm bài chưa trôi quá 50%");
        return; 
    }

    if (force || confirm("Bạn có chắc chắn muốn nộp bài làm hiện tại không?")) {
        clearInterval(timerInterval);
        
        // [VIP] TỰ ĐỘNG THOÁT TOÀN MÀN HÌNH KHI NỘP BÀI
        exitFullscreen();

        // Xóa tiến độ làm bài tạm lưu sau khi nộp
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

        const scorePayload = {
            quizId: activeQuiz.id, quizTitle: activeQuiz.title, category: activeQuiz.category,
            studentName: studentName, email: auth.currentUser ? auth.currentUser.email : "Ẩn danh",
            uid: auth.currentUser ? auth.currentUser.uid : null,
            score: `${correctCount}/${activeQuiz.questions.length}`, percentage: percent, timeUsed: isPracticeMode ? "Luyện tập" : timeUsedStr,
            teacherId: activeQuiz.authorId || null, 
            userAnswers: userAnswers, quizQuestionsSnapshot: activeQuiz.questions,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };

        db.collection("results").add(scorePayload).then(() => { console.log("Đã lưu điểm."); }).catch(err => console.error("Lỗi lưu điểm: ", err));
    }
}

function reviewQuiz() {
    isReviewMode = true; switchScreen('quiz');
    const eb = document.getElementById('energy-bar-container'); if(eb) eb.classList.add('hidden');
    const bs = document.getElementById('btn-submit'); if(bs) bs.classList.add('hidden');
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
    
    // Cập nhật màu sắc nút tab
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
    tableBody.innerHTML = '<tr><td colspan="6" class="text-center py-4">Đang tải điểm...</td></tr>';
    if (!auth.currentUser) return;

    db.collection("results").where("teacherId", "==", auth.currentUser.uid).get().then((snapshot) => {
        tableBody.innerHTML = '';
        if (snapshot.empty) { tableBody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-500">Chưa có học sinh nộp bài.</td></tr>'; return; }

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
    }).catch(err => { tableBody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-red-500">Lỗi kết nối.</td></tr>'; });
}

// --- THUẬT TOÁN NHẬP VĂN BẢN TRỰC TIẾP (SMART PASTE) ---
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
            let parseRegex = /([\s\S]*?)(?:^|\s+)([*#]*)A\s*[.)\-:,/]([\s\S]*?)(?:^|\s+)([*#]*)B\s*[.)\-:,/]([\s\S]*?)(?:^|\s+)([*#]*)C\s*[.)\-:,/]([\s\S]*?)(?:^|\s+)([*#]*)D\s*[.)\-:,/]([\s\S]*)/i;
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
                previewHTML += `<div class="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-lg text-red-600 dark:text-red-400 text-xs font-bold"><i class="fas fa-exclamation-triangle mr-1"></i> Lỗi nhận diện: Cấu trúc không hợp lệ tại đoạn: "${c}"</div>`;
            }
        }
    });

    const sqc = document.getElementById('smart-question-count'); if (sqc) sqc.innerText = `Đã nhận diện: ${currentSmartQuestions.length} câu`;
    const spb = document.getElementById('smart-preview-box');
    if (spb) {
        if (previewHTML === "") spb.innerHTML = `<p class="text-sm text-gray-400 text-center mt-10 italic">Chưa phát hiện câu hỏi nào đúng định dạng.</p>`;
        else spb.innerHTML = previewHTML;
    }
}

function saveSmartQuiz() {
    const title = document.getElementById('smart-title').value.trim(); const category = document.getElementById('smart-category').value.trim() || 'Chưa phân loại';
    const timeInput = document.getElementById('smart-time').value; const isTestOnly = document.getElementById('smart-test-only').checked;
    const statusDiv = document.getElementById('smart-status');
    
    if (!title) return alert("Vui lòng nhập Tên Đề Thi!");
    if (currentSmartQuestions.length === 0) return alert("Khung văn bản trống hoặc hệ thống chưa nhận diện được câu hỏi nào hợp lệ.");
    
    const finalTimeLimit = (timeInput && !isNaN(timeInput) && timeInput > 0) ? parseInt(timeInput) * 60 : 900;
    statusDiv.classList.remove('hidden'); statusDiv.innerText = "Đang lưu dữ liệu lên máy chủ..."; statusDiv.className = "mt-4 text-center font-bold text-amber-600 text-sm";

    const newQuiz = {
        id: "QZ-SMART-" + Date.now(), title: title, category: category, timeLimit: finalTimeLimit, 
        questions: currentSmartQuestions, isTestOnly: isTestOnly, authorId: auth.currentUser ? auth.currentUser.uid : "GUEST" 
    };
    
    db.collection("quizzes").doc(newQuiz.id).set(newQuiz).then(() => {
        document.getElementById('smart-title').value = ''; document.getElementById('smart-input-area').value = ''; document.getElementById('smart-preview-box').innerHTML = ''; document.getElementById('smart-question-count').innerText = "Đã nhận diện: 0 câu";
        currentSmartQuestions = [];
        statusDiv.innerText = `Lưu thành công đề thi "${title}" với ${newQuiz.questions.length} câu hỏi!`;
        statusDiv.className = "mt-4 text-center font-bold text-green-600 text-sm";
        setTimeout(() => statusDiv.classList.add('hidden'), 5000);
    }).catch(err => { statusDiv.innerText = "Đã xảy ra lỗi đường truyền: " + err; statusDiv.className = "mt-4 text-center font-bold text-red-600 text-sm"; });
}

function addManualQuestionForm() {
    const container = document.getElementById('manual-questions-container'); if(!container) return;
    const qDiv = document.createElement('div'); qDiv.className = 'manual-q-block p-4 sm:p-6 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl relative';
    qDiv.innerHTML = `
        <button onclick="this.parentElement.remove()" class="absolute top-3 right-3 sm:top-4 sm:right-4 text-gray-400 hover:text-red-500 transition-colors"><i class="fas fa-times text-lg sm:text-xl"></i></button>
        <h4 class="font-bold mb-3 sm:mb-4 dark:text-white text-blue-600 text-sm sm:text-base">Nội dung câu hỏi nhập liệu</h4>
        <div class="mb-3 sm:mb-4">
            <label class="text-xs sm:text-sm font-bold text-gray-500 dark:text-gray-400">Đoạn văn (Bỏ trống nếu không có):</label>
            <textarea placeholder="Nhập Reading tại đây..." class="q-passage w-full p-2 sm:p-3 mt-1 border rounded outline-none focus:border-blue-500 dark:bg-gray-800 dark:text-white dark:border-gray-600 text-sm sm:text-base" rows="3"></textarea>
        </div>
        <textarea placeholder="Câu hỏi chính..." class="q-content w-full p-2 sm:p-3 mb-3 sm:mb-4 border rounded outline-none focus:border-blue-500 dark:bg-gray-800 dark:text-white dark:border-gray-600 text-sm sm:text-base" rows="2"></textarea>
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
        <input type="text" placeholder="Giải thích (Nếu có)..." class="q-expl w-full p-2 mt-3 sm:mt-4 border rounded outline-none dark:bg-gray-800 dark:text-white dark:border-gray-600 text-sm sm:text-base">
    `;
    container.appendChild(qDiv);
}

function saveManualQuiz() {
    const titleEl = document.getElementById('manual-title'); const catEl = document.getElementById('manual-category'); const timeEl = document.getElementById('manual-time'); const testEl = document.getElementById('manual-test-only');
    const title = titleEl ? titleEl.value.trim() : ""; const category = catEl ? catEl.value.trim() : "";
    const manualMinutes = timeEl ? timeEl.value : ""; const timeLimit = parseInt(manualMinutes) * 60; const isTestOnly = testEl ? testEl.checked : false; 
    if (!title || !category || isNaN(timeLimit) || timeLimit <= 0) return alert("Vui lòng điền đủ Tên đề, Môn học và Thời gian!");
    const qBlocks = document.querySelectorAll('.manual-q-block'); if (qBlocks.length === 0) return alert("Vui lòng tạo ít nhất 1 câu hỏi!");

    let questions = []; let isValid = true;
    qBlocks.forEach(block => {
        const passage = block.querySelector('.q-passage').value.trim(); const content = block.querySelector('.q-content').value.trim();
        const opts = [block.querySelector('.q-opt-0').value.trim(), block.querySelector('.q-opt-1').value.trim(), block.querySelector('.q-opt-2').value.trim(), block.querySelector('.q-opt-3').value.trim()];
        const correct = parseInt(block.querySelector('.q-correct').value); const expl = block.querySelector('.q-expl').value.trim() || "Chưa có giải thích.";
        if (!content || opts.some(o => o === "")) isValid = false;
        questions.push({ passage: passage, content: content, options: opts, correctAnswer: correct, explanation: expl });
    });

    if (!isValid) return alert("Vui lòng nhập đủ câu hỏi và 4 đáp án!");
    const newQuiz = { id: "QZ-MANUAL-" + Date.now(), title: title, category: category, timeLimit: timeLimit, questions: questions, isTestOnly: isTestOnly, authorId: auth.currentUser ? auth.currentUser.uid : "GUEST" };

    db.collection("quizzes").doc(newQuiz.id).set(newQuiz).then(() => {
        alert("Lưu đề thành công!"); if(titleEl) titleEl.value = ''; if(catEl) catEl.value = ''; if(timeEl) timeEl.value = ''; if(testEl) testEl.checked = false;
        const mc = document.getElementById('manual-questions-container'); if(mc) mc.innerHTML = '';
        window.history.pushState({}, '', window.location.pathname); switchScreen('home'); 
    }).catch(err => alert("Lỗi lưu trữ: " + err.message));
}

// --- 10. HỆ THỐNG HIGHLIGHT 7 SẮC CẦU VỒNG ---
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
    else { document.execCommand('backColor', false, colorHex); document.execCommand('hiliteColor', false, colorHex); }
    
    if(passageEl) passageEl.contentEditable = "false"; if(questionEl) questionEl.contentEditable = "false";
    if (passageEl && activeQuiz.questions[currentQuestionIndex].passage) { activeQuiz.questions[currentQuestionIndex].passage = passageEl.innerHTML; }
    if (questionEl) { activeQuiz.questions[currentQuestionIndex].content = questionEl.innerHTML; }
    
    selection.removeAllRanges(); const palette = document.getElementById('highlight-palette'); if (palette) palette.classList.add('hidden');
}

// =========================================================================
// [VIP] HÀM BAN SẮC PHONG (NÂNG CẤP VIP TỪ GIAO DIỆN QUẢN TRỊ)
// =========================================================================
window.upgradeUserPlanByEmail = function() {
    if (!checkIsMasterAdmin()) {
        alert("To gan! Kẻ mạo danh không có quyền sử dụng Ngọc Tỷ!");
        return;
    }

    const email = document.getElementById('admin-upgrade-email').value.trim().toLowerCase();
    const newPlan = document.getElementById('admin-upgrade-plan').value;

    if (!email) return alert("Bệ hạ chưa nhập Email của sĩ tử!");

    db.collection("users").where("email", "==", email).get().then(snapshot => {
        if (snapshot.empty) return alert("Bẩm bệ hạ, không tìm thấy sĩ tử nào mang Email này trong hệ thống!");
        
        snapshot.forEach(doc => {
            doc.ref.update({ plan: newPlan }).then(() => {
                alert(`Thánh chỉ đã ban! Tài khoản ${email} đã được thăng cấp lên Gói ${newPlan.toUpperCase()}.`);
                document.getElementById('admin-upgrade-email').value = ""; // Xóa trắng ô nhập
            });
        });
    }).catch(err => alert("Có tà khí can nhiễu đường truyền: " + err.message));
}

// =========================================================================
// [VIP] TRẬN PHÁP THIẾT QUÂN LUẬT: KHÓA TOÀN MÀN HÌNH
// =========================================================================

function enterFullscreen() {
    const elem = document.documentElement;
    if (elem.requestFullscreen) { elem.requestFullscreen().catch(err => console.log(err)); }
    else if (elem.webkitRequestFullscreen) { elem.webkitRequestFullscreen(); } // Safari
    else if (elem.msRequestFullscreen) { elem.msRequestFullscreen(); } // IE11
}

function exitFullscreen() {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) { document.exitFullscreen(); }
        else if (document.webkitExitFullscreen) { document.webkitExitFullscreen(); }
    }
}

// Lắng nghe sự kiện thoát Full-screen của trình duyệt
document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

function handleFullscreenChange() {
    // Chỉ kích hoạt khóa nếu ĐANG ở chế độ THI THỬ (không phải luyện tập/xem lại)
    if (!isPracticeMode && !isReviewMode && screens.quiz && !screens.quiz.classList.contains('hidden')) {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            // Sĩ tử vừa thoát toàn màn hình -> Giáng đòn Phong ấn!
            showFullscreenLock();
        }
    }
}

function showFullscreenLock() {
    let lockOverlay = document.getElementById('fullscreen-lock-overlay');
    
    // Nếu chưa có màn khóa thì tạo mới
    if (!lockOverlay) {
        lockOverlay = document.createElement('div');
        lockOverlay.id = 'fullscreen-lock-overlay';
        lockOverlay.className = 'fixed inset-0 bg-gray-900/95 z-[9999] flex flex-col items-center justify-center backdrop-blur-md';
        lockOverlay.innerHTML = `
            <i class="fas fa-user-shield text-red-500 text-6xl mb-6 animate-bounce"></i>
            <h2 class="font-academic text-3xl sm:text-4xl font-bold text-white mb-3 text-center">CẢNH BÁO THIẾT QUÂN LUẬT</h2>
            <p class="text-gray-300 mb-8 text-center max-w-lg text-sm sm:text-base px-4">
                Ngươi đã thoát chế độ toàn màn hình trong lúc thi. Để đảm bảo tính minh bạch, bài thi đã bị tạm khóa. Thời gian vẫn đang trôi qua!
            </p>
            <button id="btn-return-fullscreen" class="px-8 py-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-lg transition-all text-lg flex items-center gap-2">
                <i class="fas fa-expand"></i> Quay Lại Bài Thi Ngay
            </button>
        `;
        document.body.appendChild(lockOverlay);
        
        // Sự kiện khi bấm nút quay lại
        document.getElementById('btn-return-fullscreen').addEventListener('click', () => {
            enterFullscreen();
            // Đợi nửa giây để trình duyệt kịp bung full-screen rồi mới cất màn khóa
            setTimeout(() => {
                if (document.fullscreenElement || document.webkitFullscreenElement) {
                    lockOverlay.classList.add('hidden');
                }
            }, 500);
        });
    }
    
    lockOverlay.classList.remove('hidden');
}
