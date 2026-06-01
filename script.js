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
let screens = {}; // Khai báo rỗng để chống lỗi null

// --- 3. THEO DÕI TRẠNG THÁI & KHỞI TẠO AN TOÀN ---
document.addEventListener("DOMContentLoaded", () => { 
    // Gắn ID màn hình SAU KHI HTML đã tải xong để chống lỗi Trắng Màn Hình
    screens = {
        auth: document.getElementById('auth-screen'),
        home: document.getElementById('home-screen'),
        subjectDetail: document.getElementById('subject-detail-screen'),
        welcome: document.getElementById('welcome-screen'),
        quiz: document.getElementById('quiz-screen'),
        result: document.getElementById('result-screen'),
        admin: document.getElementById('admin-zone')
    };

    setupEventListeners(); 
    
    auth.onAuthStateChanged((user) => {
        if (user) {
            if (user.displayName) {
                const nameEl = document.getElementById('student-name');
                if(nameEl) nameEl.value = user.displayName;
            }
            setRole('student');
            fetchQuizzesFromFirebase(); 

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

function fetchQuizzesFromFirebase() {
    if (!auth.currentUser) return;

    db.collection("quizzes")
      .where("authorId", "==", auth.currentUser.uid)
      .onSnapshot((snapshot) => {
        quizDatabase = [];
        snapshot.forEach((doc) => {
            quizDatabase.push(doc.data());
        });
        if (screens.home && !screens.home.classList.contains('hidden')) renderHomeQuizList(); 
        if (screens.subjectDetail && !screens.subjectDetail.classList.contains('hidden')) renderSubjectDetailView(currentSelectedCategory);
    }, (error) => {
        console.error("Lỗi khi tải dữ liệu: ", error);
    });
}

function checkUrlForSharedQuiz(quizId) {
    db.collection("quizzes").doc(quizId).get().then((doc) => {
        if (doc.exists) {
            activeQuiz = doc.data();
            prepareWelcomeScreen();
        } else {
            alert("Đề thi này không tồn tại hoặc đã bị gỡ bỏ khỏi hệ thống!");
            switchScreen('home');
        }
        window.history.replaceState({}, document.title, window.location.pathname);
    }).catch(err => {
        console.error("Lỗi link: ", err);
        switchScreen('home');
    });
}

function copyLink(link) {
    navigator.clipboard.writeText(link).then(() => {
        alert("Đã sao chép liên kết thành công! Bạn có thể dán để gửi cho học sinh.");
    });
}

// --- 4. CẤU HÌNH SỰ KIỆN GIAO DIỆN CHỐNG LỖI (BULLETPROOF) ---
function setupEventListeners() {
    const addEvt = (id, event, handler) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(event, handler);
    };

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
        if (confirm("Thoát? Kết quả làm bài hiện tại sẽ mất.")) {
            clearInterval(timerInterval); 
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
    addEvt('upload-docx', 'change', handleDocxImport);
    document.addEventListener('visibilitychange', handleVisibilityChange);
}

function toggleAuthMode(loginMode) {
    isLoginMode = loginMode;
    const title = document.getElementById('auth-title');
    const btnSubmit = document.getElementById('btn-auth-submit');
    const toggleMsg = document.getElementById('auth-toggle-msg');
    const toggleBtn = document.getElementById('btn-auth-toggle');
    const nameField = document.getElementById('div-auth-name');

    if(!title || !btnSubmit) return;

    document.getElementById('auth-email').value = '';
    document.getElementById('auth-password').value = '';
    const nameInput = document.getElementById('auth-name');
    if(nameInput) nameInput.value = '';

    if (isLoginMode) {
        title.innerText = "Đăng Nhập Hệ Thống";
        btnSubmit.innerText = "Đăng Nhập";
        toggleMsg.innerText = "Chưa có tài khoản?";
        toggleBtn.innerText = "Đăng ký ngay";
        if(nameField) nameField.classList.add('hidden');
    } else {
        title.innerText = "Đăng Ký Tài Khoản";
        btnSubmit.innerText = "Tạo Tài Khoản";
        toggleMsg.innerText = "Đã có tài khoản?";
        toggleBtn.innerText = "Đăng nhập ngay";
        if(nameField) nameField.classList.remove('hidden');
    }
}

function handleAuthSubmit() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value.trim();
    const nameInput = document.getElementById('auth-name');
    const name = nameInput ? nameInput.value.trim() : "";

    if (!email || !password) return alert("Nhập đủ Email và Mật khẩu!");

    if (isLoginMode) {
        auth.signInWithEmailAndPassword(email, password).catch(err => alert("Đăng nhập thất bại: " + err.message));
    } else {
        if (!name) return alert("Nhập Họ và tên để tạo hồ sơ!");
        auth.createUserWithEmailAndPassword(email, password).then((result) => {
            return result.user.updateProfile({ displayName: name });
        }).then(() => {
            alert("Đăng ký thành công!");
            auth.currentUser.reload();
        }).catch(err => alert("Lỗi đăng ký: " + err.message));
    }
}

function setRole(role) {
    currentRole = role;
    const btnStudent = document.getElementById('role-student');
    const btnTeacher = document.getElementById('role-teacher');
    const btnAdmin = document.getElementById('btn-show-admin');
    const studentTabs = document.getElementById('student-tabs');

    if(btnStudent) btnStudent.className = 'flex-1 md:flex-none px-4 sm:px-8 py-2.5 rounded-lg font-bold transition-all text-gray-500 hover:text-gray-700 dark:text-gray-400';
    if(btnTeacher) btnTeacher.className = 'flex-1 md:flex-none px-4 sm:px-8 py-2.5 rounded-lg font-bold transition-all text-gray-500 hover:text-gray-700 dark:text-gray-400';

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
    const btnBrowse = document.getElementById('btn-tab-browse');
    const btnHistory = document.getElementById('btn-tab-history');
    
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
    Object.values(screens).forEach(screen => {
        if(screen) {
            screen.classList.add('hidden');
            screen.classList.remove('flex'); 
        }
    });
    
    if(screens[screenName]) {
        screens[screenName].classList.remove('hidden');
        if (screenName === 'quiz') {
            screens[screenName].classList.add('flex');
        }
    }

    if(screenName === 'home') renderHomeQuizList();
    if(screenName === 'subjectDetail') renderSubjectDetailView(currentSelectedCategory);
    if(screenName === 'admin') {
        switchAdminTab('docx');
        const mc = document.getElementById('manual-questions-container');
        if(mc) mc.innerHTML = '';
        const dc = document.getElementById('docx-test-only');
        if(dc) dc.checked = false;
        const mt = document.getElementById('manual-test-only');
        if(mt) mt.checked = false;
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
            card.onclick = () => {
                currentSelectedCategory = category;
                switchScreen('subjectDetail');
            };
            container.appendChild(card);
        });
    } 
    else if (currentRole === 'student' && currentStudentTab === 'history') {
        if (!auth.currentUser) return;
        container.innerHTML = '<p class="col-span-full text-center text-gray-500 py-4">Đang kết nối tải tệp đề đã làm...</p>';
        
        db.collection("results").where("uid", "==", auth.currentUser.uid).get().then((snapshot) => {
            container.innerHTML = '';
            if (snapshot.empty) {
                container.innerHTML = '<p class="col-span-full text-center text-gray-500 py-8">Kho trống. Bạn chưa thực hiện bài thi nào.</p>';
                return;
            }
            
            let listHistory = [];
            snapshot.forEach(doc => {
                listHistory.push({ id: doc.id, data: doc.data() });
            });
            
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
                
                let isMock = res.quizId.startsWith("MOCK-GENERATED-");
                let actionBtnHTML = isMock ? '' : `<button onclick="redoQuizFromHistory('${res.quizId}')" class="px-3 py-1.5 bg-blue-900 text-white text-xs font-bold rounded-lg hover:bg-blue-800 transition-colors"><i class="fas fa-redo mr-1"></i>Làm lại</button>`;

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
                    <div class="flex justify-end border-t dark:border-gray-600 pt-2 mt-auto">
                        ${actionBtnHTML}
                    </div>
                `;
                container.appendChild(card);
            });
        }).catch(err => {
            container.innerHTML = '<p class="col-span-full text-center text-red-500 py-4">Lỗi kết nối tệp điểm đám mây.</p>';
        });
    }
}

function redoQuizFromHistory(quizId) {
    db.collection("quizzes").doc(quizId).get().then((doc) => {
        if (doc.exists) {
            activeQuiz = doc.data();
            prepareWelcomeScreen();
        } else {
            alert("Đề thi gốc này đã bị gỡ bỏ khỏi hệ thống dữ liệu!");
        }
    }).catch(err => alert("Lỗi tải đề: " + err.message));
}

function deleteHistoryEntry(docId) {
    if (confirm("Xóa lịch sử này khỏi Kho Đã Làm? Đề gốc sẽ không bị ảnh hưởng.")) {
        db.collection("results").doc(docId).delete().then(() => {
            renderHomeQuizList();
        }).catch(err => alert("Lỗi xóa: " + err.message));
    }
}

// --- 6. RENDER CHI TIẾT MÔN HỌC ---
function renderSubjectDetailView(category) {
    const titleEl = document.getElementById('subject-detail-title');
    if(titleEl) titleEl.innerText = "Môn học: " + category;
    
    const container = document.getElementById('chapter-list-container');
    if(!container) return;
    container.innerHTML = '';

    const quizzesInFolder = quizDatabase.filter(q => q.category === category);
    
    if(quizzesInFolder.length === 0) {
        container.innerHTML = '<p class="col-span-full text-center text-gray-500 py-4">Thư mục môn học này hiện đang trống.</p>';
        return;
    }

    quizzesInFolder.forEach(quiz => {
        const card = document.createElement('div');
        card.className = 'relative p-6 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-2xl shadow-sm hover:shadow-lg transition-all group';
        
        let actionBtnsHTML = '';
        let badgeHTML = quiz.isTestOnly ? 
            '<span class="px-3 py-1 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs font-bold rounded-full border dark:border-red-800">Đề Kiểm Tra</span>' : 
            '<span class="px-3 py-1 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-xs font-bold rounded-full border dark:border-gray-500">Đề bài lẻ</span>';

        if (currentRole === 'teacher') {
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
        db.collection("quizzes").doc(quizId).delete().then(() => {
            renderSubjectDetailView(currentSelectedCategory);
        }).catch(err => alert("Lỗi khi xóa dữ liệu: " + err));
    }
}

function generateSubjectMockTest() {
    const sel = document.getElementById('mock-question-count');
    const countSelect = sel ? parseInt(sel.value) : 50;
    const quizzesInFolder = quizDatabase.filter(q => q.category === currentSelectedCategory);
    
    let poolQuestions = [];
    quizzesInFolder.forEach(quiz => {
        if(quiz.questions && Array.isArray(quiz.questions)) {
            poolQuestions = poolQuestions.concat(quiz.questions);
        }
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
        title: `Đề Tổng Hợp Ngẫu Nhiên Môn ${currentSelectedCategory}`,
        category: currentSelectedCategory,
        timeLimit: finalCount * 60, 
        questions: slicedQuestions,
        isTestOnly: false,
        authorId: auth.currentUser ? auth.currentUser.uid : "GUEST"
    };

    prepareWelcomeScreen();
}

function prepareWelcomeScreen() {
    const titleEl = document.getElementById('selected-quiz-title');
    if(titleEl) titleEl.innerText = activeQuiz.title;
    
    const btnPractice = document.getElementById('btn-practice');
    const gridContainer = document.getElementById('welcome-action-buttons');
    
    if (activeQuiz.isTestOnly) {
        if(btnPractice) btnPractice.classList.add('hidden');
        if(gridContainer) gridContainer.classList.replace('sm:grid-cols-2', 'sm:grid-cols-1');
    } else {
        if(btnPractice) btnPractice.classList.remove('hidden');
        if(gridContainer) gridContainer.classList.replace('sm:grid-cols-1', 'sm:grid-cols-2');
    }

    switchScreen('welcome');
}

// --- 8. LOGIC TRƯỜNG THI & GHI ĐIỂM ---
function startQuiz(practice) {
    const nameInputEl = document.getElementById('student-name');
    const nameInput = nameInputEl ? nameInputEl.value.trim() : "";
    if (!nameInput) return alert("Vui lòng nhập họ và tên trước khi bắt đầu!");
    
    studentName = nameInput;
    isPracticeMode = practice; isReviewMode = false; tabSwitchCount = 0;

    activeQuiz = JSON.parse(JSON.stringify(activeQuiz));

    let groupedQuestions = [];
    let currentPassage = null;
    let currentGroup = [];

    activeQuiz.questions.forEach(q => {
        if (q.passage !== currentPassage) {
            if (currentGroup.length > 0) groupedQuestions.push(currentGroup);
            currentGroup = [q];
            currentPassage = q.passage;
        } else {
            currentGroup.push(q);
        }
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
            let opts = q.options.map((text, idx) => ({ text: text, isCorrect: idx === q.correctAnswer }));
            
            for (let i = opts.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [opts[i], opts[j]] = [opts[j], opts[i]];
            }
            
            q.options = opts.map(o => o.text);
            q.correctAnswer = opts.findIndex(o => o.isCorrect);
        });
    });

    activeQuiz.questions = groupedQuestions.flat();

    userAnswers = new Array(activeQuiz.questions.length).fill(null);
    flaggedQuestions = new Array(activeQuiz.questions.length).fill(false);
    timeLeft = activeQuiz.timeLimit;
    
    currentFilter = 'all';
    const fPract = document.getElementById('filter-tabs-practice');
    const fRev = document.getElementById('filter-tabs-review');
    if(fPract) fPract.classList.replace('hidden', 'grid');
    if(fRev) fRev.classList.replace('grid', 'hidden');
    resetFilterButtons(fPract);

    const dName = document.getElementById('display-student-name');
    if(dName) dName.innerText = studentName;
    const qTitle = document.getElementById('quiz-header-title');
    if(qTitle) qTitle.innerText = activeQuiz.title;
    const eBar = document.getElementById('energy-bar-container');
    if(eBar) eBar.classList.remove('hidden');

    switchScreen('quiz');
    loadQuestion(0);
    startTimer();
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
    const grid = document.getElementById('navigator-grid');
    if(!grid) return;
    grid.innerHTML = '';
    
    activeQuiz.questions.forEach((_, i) => {
        let isDone = userAnswers[i] !== null;
        let isFlagged = flaggedQuestions[i];
        let isCorrect = isDone && userAnswers[i] === activeQuiz.questions[i].correctAnswer;
        let isWrong = isDone && userAnswers[i] !== activeQuiz.questions[i].correctAnswer;

        if (currentFilter === 'pending' && isDone) return;
        if (currentFilter === 'done' && !isDone) return;
        if (currentFilter === 'flagged' && !isFlagged) return;
        if (currentFilter === 'correct' && (!isDone || !isCorrect)) return;
        if (currentFilter === 'wrong' && (!isDone || !isWrong)) return;

        const btn = document.createElement('button');
        btn.innerText = i + 1;
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
        btn.className = baseClass;
        btn.onclick = () => loadQuestion(i);
        grid.appendChild(btn);
    });
}

function toggleFlag() {
    flaggedQuestions[currentQuestionIndex] = !flaggedQuestions[currentQuestionIndex];
    loadQuestion(currentQuestionIndex); 
    if (currentFilter === 'flagged') renderNavigator(); 
}

function loadQuestion(index) {
    if(index < 0 || index >= activeQuiz.questions.length) return;
    currentQuestionIndex = index;
    const q = activeQuiz.questions[index];
    
    const counter = document.getElementById('question-counter');
    if(counter) counter.innerText = `Câu ${index + 1} / ${activeQuiz.questions.length}`;
    const content = document.getElementById('question-content');
    if(content) content.innerHTML = q.content;
    
    const passageContainer = document.getElementById('passage-container');
    const questionWrapper = document.getElementById('question-wrapper');
    const passageText = document.getElementById('passage-text');

    if (q.passage && q.passage.trim() !== "") {
        if(passageContainer) passageContainer.classList.remove('hidden');
        if(questionWrapper) questionWrapper.classList.replace('w-full', 'md:w-1/2');
        if(passageText) passageText.innerText = q.passage.trim();
    } else {
        if(passageContainer) passageContainer.classList.add('hidden');
        if(questionWrapper) questionWrapper.classList.replace('md:w-1/2', 'w-full');
        if(passageText) passageText.innerText = "";
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
        q.options.forEach((optText, optIndex) => {
            const btn = document.createElement('button');
            btn.className = 'option-btn text-left p-3 sm:p-4 rounded-xl flex items-center gap-3 sm:gap-4 border-2 border-gray-200 bg-white dark:bg-gray-800 dark:border-gray-600 transition-all';
            btn.innerHTML = `<span class="option-label w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center rounded-lg bg-gray-100 font-bold text-gray-500 shrink-0 text-sm sm:text-base">${labels[optIndex]}</span><span class="text-base sm:text-lg font-academic dark:text-gray-200">${optText}</span>`;
            
            if (userAnswers[index] === optIndex) {
                btn.classList.add('ring-4', 'ring-blue-100', 'border-blue-600', 'bg-blue-50', 'dark:bg-blue-900');
                btn.querySelector('.option-label').classList.replace('bg-gray-100', 'bg-blue-600');
                btn.querySelector('.option-label').classList.replace('text-gray-500', 'text-white');
            }
            btn.onclick = () => { userAnswers[currentQuestionIndex] = optIndex; loadQuestion(currentQuestionIndex); };
            optionsContainer.appendChild(btn);
        });
    }

    const hintBtn = document.getElementById('btn-hint');
    const hintBox = document.getElementById('hint-box');
    if(hintBox) hintBox.classList.add('hidden');
    if(hintBtn) {
        if (isPracticeMode && !isReviewMode && q.hint && userAnswers[index] === null) hintBtn.classList.remove('hidden');
        else hintBtn.classList.add('hidden');
    }

    const bPrev = document.getElementById('btn-prev');
    if(bPrev) bPrev.disabled = index === 0;
    const bNext = document.getElementById('btn-next');
    if(bNext) bNext.classList.toggle('hidden', index === activeQuiz.questions.length - 1);
    const bSub = document.getElementById('btn-submit');
    if(bSub) bSub.classList.toggle('hidden', index !== activeQuiz.questions.length - 1 || isReviewMode);

    const explanationBox = document.getElementById('explanation-box');
    if (explanationBox && optionsContainer) {
        if (isReviewMode || (isPracticeMode && userAnswers[index] !== null)) {
            const siblings = optionsContainer.children;
            if(siblings[q.correctAnswer]) {
                siblings[q.correctAnswer].classList.replace('border-gray-200', 'border-green-500');
                siblings[q.correctAnswer].classList.add('bg-green-50', 'dark:bg-green-900/30');
            }
            if (userAnswers[index] !== null && userAnswers[index] !== q.correctAnswer && siblings[userAnswers[index]]) {
                siblings[userAnswers[index]].classList.replace('border-blue-600', 'border-red-500');
                siblings[userAnswers[index]].classList.add('bg-red-50', 'dark:bg-red-900/30');
            }
            for (let el of siblings) el.style.pointerEvents = 'none';
            
            const eText = document.getElementById('explanation-text');
            if(eText) eText.innerText = q.explanation || "Chưa có giải thích.";
            explanationBox.classList.remove('hidden');
            if(hintBtn) hintBtn.classList.add('hidden');
        } else {
            explanationBox.classList.add('hidden');
        }
    }
    
    renderNavigator(); 
}

function startTimer() {
    const energyFill = document.getElementById('energy-fill');
    const timeText = document.getElementById('time-text');
    const totalTime = activeQuiz.timeLimit;

    timerInterval = setInterval(() => {
        timeLeft--;
        let percentage = (timeLeft / totalTime) * 100;
        if(energyFill) energyFill.style.width = percentage + '%';
        
        if(timeText) {
            timeText.innerText = `${Math.floor(timeLeft / 60).toString().padStart(2, '0')}:${(timeLeft % 60).toString().padStart(2, '0')}`;

            if (percentage <= 15) {
                energyFill.className = 'energy-fill bg-danger pulse-active';
                timeText.className = 'font-mono font-bold text-2xl sm:text-3xl text-red-600 tabular-nums';
            } else if (percentage <= 50) {
                energyFill.className = 'energy-fill bg-warn';
                timeText.className = 'font-mono font-bold text-2xl sm:text-3xl text-amber-600 tabular-nums';
            } else {
                energyFill.className = 'energy-fill bg-safe';
                timeText.className = 'font-mono font-bold text-2xl sm:text-3xl text-blue-900 dark:text-white tabular-nums';
            }
        }

        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            alert("Hết giờ làm bài! Tự động nộp bài.");
            submitQuiz(true);
        }
    }, 1000);
}

function handleVisibilityChange() {
    if (document.hidden && !isPracticeMode && !isReviewMode && screens.quiz && !screens.quiz.classList.contains('hidden')) {
        if (++tabSwitchCount >= 2) { 
            alert("CẢNH BÁO VI PHẠM: Thoát trình duyệt 2 lần, tự động thu bài!"); 
            submitQuiz(true); 
        } else {
            alert("NHẮC NHỞ: Không được chuyển tab khi đang thi thử!");
        }
    }
}

function submitQuiz(force) {
    if (force || confirm("Nộp bài làm hiện tại?")) {
        clearInterval(timerInterval);
        let correctCount = userAnswers.filter((ans, i) => ans === activeQuiz.questions[i].correctAnswer).length;
        
        const timeUsed = activeQuiz.timeLimit - (timeLeft > 0 ? timeLeft : 0);
        const timeUsedStr = `${Math.floor(timeUsed / 60).toString().padStart(2, '0')}:${(timeUsed % 60).toString().padStart(2, '0')}`;
        const percent = Math.round((correctCount / activeQuiz.questions.length) * 100);

        switchScreen('result');
        const sc = document.getElementById('result-score');
        if(sc) sc.innerText = `${correctCount}/${activeQuiz.questions.length}`;
        const pc = document.getElementById('result-percent');
        if(pc) pc.innerText = `${percent}%`;
        const tc = document.getElementById('result-time');
        if(tc) tc.innerText = timeUsedStr;

        const scorePayload = {
            quizId: activeQuiz.id,
            quizTitle: activeQuiz.title,
            category: activeQuiz.category,
            studentName: studentName,
            email: auth.currentUser ? auth.currentUser.email : "Ẩn danh",
            uid: auth.currentUser ? auth.currentUser.uid : null,
            score: `${correctCount}/${activeQuiz.questions.length}`,
            percentage: percent,
            timeUsed: timeUsedStr,
            teacherId: activeQuiz.authorId || null, 
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };

        db.collection("results").add(scorePayload).then(() => {
            console.log("Đã lưu điểm.");
        }).catch(err => console.error("Lỗi lưu điểm: ", err));
    }
}

function reviewQuiz() {
    isReviewMode = true;
    switchScreen('quiz');
    const eb = document.getElementById('energy-bar-container');
    if(eb) eb.classList.add('hidden');
    const bs = document.getElementById('btn-submit');
    if(bs) bs.classList.add('hidden');
    
    currentFilter = 'all';
    const fp = document.getElementById('filter-tabs-practice');
    if(fp) fp.classList.replace('grid', 'hidden');
    const fr = document.getElementById('filter-tabs-review');
    if(fr) fr.classList.replace('hidden', 'grid');
    resetFilterButtons(fr);

    loadQuestion(0);
}

// --- 9. ADMIN ZONE ---
function switchAdminTab(tabName) {
    const btnDocx = document.getElementById('tab-docx');
    const btnManual = document.getElementById('tab-manual');
    const btnStats = document.getElementById('tab-stats');
    const panelDocx = document.getElementById('panel-docx');
    const panelManual = document.getElementById('panel-manual');
    const panelStats = document.getElementById('panel-stats');

    [btnDocx, btnManual, btnStats].forEach(btn => {
        if(btn) btn.className = 'flex-1 md:flex-none px-3 sm:px-4 py-2 text-sm sm:text-base font-bold rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700';
    });
    [panelDocx, panelManual, panelStats].forEach(panel => {
        if(panel) panel.classList.replace('block', 'hidden');
    });

    if (tabName === 'docx' && btnDocx && panelDocx) {
        btnDocx.className = 'flex-1 md:flex-none px-3 sm:px-4 py-2 text-sm sm:text-base font-bold rounded-lg bg-blue-100 text-blue-700';
        panelDocx.classList.replace('hidden', 'block');
    } else if (tabName === 'manual' && btnManual && panelManual) {
        btnManual.className = 'flex-1 md:flex-none px-3 sm:px-4 py-2 text-sm sm:text-base font-bold rounded-lg bg-blue-100 text-blue-700';
        panelManual.classList.replace('hidden', 'block');
    } else if (tabName === 'stats' && btnStats && panelStats) {
        btnStats.className = 'w-full md:w-auto px-3 sm:px-4 py-2 text-sm sm:text-base font-bold rounded-lg bg-blue-100 text-blue-700';
        panelStats.classList.replace('hidden', 'block');
        fetchResultsFromFirebase(); 
    }
}

function fetchResultsFromFirebase() {
    const tableBody = document.getElementById('stats-table-body');
    if(!tableBody) return;
    tableBody.innerHTML = '<tr><td colspan="6" class="text-center py-4">Đang tải điểm...</td></tr>';

    if (!auth.currentUser) return;

    db.collection("results").where("teacherId", "==", auth.currentUser.uid).get().then((snapshot) => {
        tableBody.innerHTML = '';
        if (snapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-500">Chưa có học sinh nộp bài.</td></tr>';
            return;
        }

        let results = [];
        snapshot.forEach(doc => results.push(doc.data()));
        
        results.sort((a, b) => {
            let timeA = a.timestamp ? a.timestamp.seconds : 0;
            let timeB = b.timestamp ? b.timestamp.seconds : 0;
            return timeB - timeA;
        });

        results.forEach((res) => {
            const formatStr = res.timestamp ? new Date(res.timestamp.seconds * 1000).toLocaleString('vi-VN') : "Vừa xong";
            const row = document.createElement('tr');
            row.className = 'border-b dark:border-gray-700 text-sm hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors';
            
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
    }).catch(err => {
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-red-500">Lỗi kết nối.</td></tr>';
    });
}

function handleDocxImport(event) {
    const file = event.target.files[0];
    const catEl = document.getElementById('docx-category');
    const categoryInput = catEl ? catEl.value.trim() || 'Chưa phân loại' : 'Chưa phân loại';
    const testEl = document.getElementById('docx-test-only');
    const isTestOnly = testEl ? testEl.checked : false; 
    
    const timeEl = document.getElementById('docx-time');
    const timeInput = timeEl ? timeEl.value : "";
    const finalTimeLimit = (timeInput && !isNaN(timeInput) && timeInput > 0) ? parseInt(timeInput) * 60 : 1800;
    
    if (!file) return;
    
    const statusDiv = document.getElementById('import-status');
    if(statusDiv) {
        statusDiv.classList.remove('hidden');
        statusDiv.innerText = "Đang rà quét tệp Word bằng thuật toán tối thượng...";
        statusDiv.className = "mt-4 text-center font-bold text-amber-600";
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        mammoth.extractRawText({arrayBuffer: e.target.result}).then(function(result) {
            let text = result.value;
            // Phép thuật thanh tẩy 1: Xóa sạch mọi ký tự khoảng trắng tàng hình gây lỗi
            text = text.replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ');

            const regex = /(?=\[Bài đọc\]|\[Hết bài đọc\]|Câu \d+[:.])/i;
            const blocks = text.split(regex).filter(q => q.trim().length > 0);
            
            let parsedQuestions = [];
            let currentPassage = "";
            let errorLog = "";
            
            blocks.forEach((block) => {
                let trimmed = block.trim();
                
                if (trimmed.match(/^\[Bài đọc\]/i)) {
                    currentPassage = trimmed.replace(/^\[Bài đọc\]/i, '').trim();
                } else if (trimmed.match(/^\[Hết bài đọc\]/i)) {
                    currentPassage = "";
                } else if (trimmed.match(/^Câu \d+[:.]/i)) {
                    
                    // Phép thuật thanh tẩy 2: Ép tách các đáp án bị dính liền vào từ trước đó (VD: (WORK)A. hoặc mak...*B.)
                    // Hỗ trợ thả ga các dấu phân cách: A. A) A: A- A,
                    trimmed = trimmed.replace(/(^|[^a-zA-Z0-9_])([*#]*\s*[A-D]\s*[.)\-:,])/ig, '$1\n$2');

                    let lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
                    let content = "";
                    let options = ["", "", "", ""];
                    let correctIndex = 0;
                    let currentOpt = -1; 
                    let foundLabels = new Set();

                    lines.forEach(line => {
                        // Quét đáp án siêu rộng lượng: Cho phép nhiều dấu sao, khoảng trắng, các loại dấu chấm/ngoặc
                        let matchOpt = line.match(/^([*#\s]*)([A-D])\s*[.)\-:,](.*)/i);
                        
                        if (matchOpt) {
                            let star = matchOpt[1];
                            let label = matchOpt[2].toUpperCase();
                            let textOpt = matchOpt[3].trim();
                            let idx = label.charCodeAt(0) - 65; 

                            // Ghi đè đáp án (Nếu trong câu hỏi lỡ có chữ trùng khớp dạng A. thì sẽ bị đáp án thật ở cuối ghi đè lên, chống lỗi false positive)
                            currentOpt = idx;
                            foundLabels.add(label);
                            if (star.includes('*') || star.includes('#')) correctIndex = idx;
                            options[idx] = textOpt;
                        } else {
                            // Nếu không phải A, B, C, D thì nó là văn bản nối tiếp của dòng trên
                            if (currentOpt === -1) {
                                content += (content ? "\n" : "") + line;
                            } else {
                                options[currentOpt] += " " + line;
                            }
                        }
                    });

                    // Dọn dẹp rác ở đầu và cuối
                    content = content.replace(/^Câu \d+[:.]/i, '').trim();
                    if(options[3].toLowerCase().includes("đáp án")) {
                        options[3] = options[3].split(/đáp án/i)[0].trim();
                    }

                    // Chốt hạ: Chỉ kết nạp khi đã gom đủ cả 4 mảnh A, B, C, D
                    if (foundLabels.has('A') && foundLabels.has('B') && foundLabels.has('C') && foundLabels.has('D')) {
                        parsedQuestions.push({
                            content: content,
                            options: options,
                            correctAnswer: correctIndex, 
                            explanation: "Tạo tự động từ tệp DOCX.",
                            passage: currentPassage 
                        });
                    } else {
                        // Báo lỗi chi tiết đang thiếu chữ cái nào
                        let missing = ['A','B','C','D'].filter(l => !foundLabels.has(l)).join(', ');
                        errorLog += `\n- Lỗi ở: "${content.substring(0, 30)}..." (Thiếu đáp án: ${missing})`;
                    }
                }
            });

            if(parsedQuestions.length > 0 && errorLog === "") {
                const newQuiz = {
                    id: "QZ-DOCX-" + Date.now(),
                    title: file.name.replace('.docx', ''),
                    category: categoryInput,
                    timeLimit: finalTimeLimit, 
                    questions: parsedQuestions,
                    isTestOnly: isTestOnly,
                    authorId: auth.currentUser ? auth.currentUser.uid : "GUEST" 
                };
                
                db.collection("quizzes").doc(newQuiz.id).set(newQuiz).then(() => {
                    if(catEl) catEl.value = ''; 
                    if(timeEl) timeEl.value = ''; 
                    if(testEl) testEl.checked = false;
                    if(statusDiv) {
                        statusDiv.innerText = `Thắng lợi! Đã nạp thành công ${parsedQuestions.length} câu lên đám mây.`;
                        statusDiv.className = "mt-4 text-center font-bold text-green-600";
                    }
                }).catch(err => {
                    if(statusDiv) {
                        statusDiv.innerText = "Lỗi đường truyền Firebase: " + err;
                        statusDiv.className = "mt-4 text-center font-bold text-red-600";
                    }
                });
                
            } else if (parsedQuestions.length > 0 && errorLog !== "") {
                if(statusDiv) {
                    statusDiv.innerText = `Nạp được ${parsedQuestions.length} câu, nhưng từ chối một số câu: ${errorLog}`;
                    statusDiv.className = "mt-4 text-left text-sm font-bold text-amber-600 whitespace-pre-wrap";
                }
            } else {
                if(statusDiv) {
                    statusDiv.innerText = `Nạp thất bại toàn tập: ${errorLog}`;
                    statusDiv.className = "mt-4 text-left text-sm font-bold text-red-600 whitespace-pre-wrap";
                }
            }
        }).catch(err => {
            if(statusDiv) {
                statusDiv.innerText = "Lỗi bóc tách tệp: Đuôi file DOCX bị hỏng hoặc không đọc được.";
                statusDiv.className = "mt-4 text-center font-bold text-red-600";
            }
        });
    };
    reader.readAsArrayBuffer(file);
}

function addManualQuestionForm() {
    const container = document.getElementById('manual-questions-container');
    if(!container) return;
    const qDiv = document.createElement('div');
    qDiv.className = 'manual-q-block p-4 sm:p-6 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl relative';
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
            <select class="q-correct p-2 border rounded outline-none dark:bg-gray-800 dark:text-white dark:border-gray-600 w-full sm:w-auto text-sm sm:text-base">
                <option value="0">A</option><option value="1">B</option><option value="2">C</option><option value="3">D</option>
            </select>
        </div>
        <input type="text" placeholder="Giải thích (Nếu có)..." class="q-expl w-full p-2 mt-3 sm:mt-4 border rounded outline-none dark:bg-gray-800 dark:text-white dark:border-gray-600 text-sm sm:text-base">
    `;
    container.appendChild(qDiv);
}

function saveManualQuiz() {
    const titleEl = document.getElementById('manual-title');
    const catEl = document.getElementById('manual-category');
    const timeEl = document.getElementById('manual-time');
    const testEl = document.getElementById('manual-test-only');

    const title = titleEl ? titleEl.value.trim() : "";
    const category = catEl ? catEl.value.trim() : "";
    const manualMinutes = timeEl ? timeEl.value : "";
    const timeLimit = parseInt(manualMinutes) * 60; 
    const isTestOnly = testEl ? testEl.checked : false; 

    if (!title || !category || isNaN(timeLimit) || timeLimit <= 0) {
        return alert("Vui lòng điền đủ Tên đề, Môn học và Thời gian!");
    }

    const qBlocks = document.querySelectorAll('.manual-q-block');
    if (qBlocks.length === 0) return alert("Vui lòng tạo ít nhất 1 câu hỏi!");

    let questions = [];
    let isValid = true;

    qBlocks.forEach(block => {
        const passage = block.querySelector('.q-passage').value.trim();
        const content = block.querySelector('.q-content').value.trim();
        const opts = [
            block.querySelector('.q-opt-0').value.trim(),
            block.querySelector('.q-opt-1').value.trim(),
            block.querySelector('.q-opt-2').value.trim(),
            block.querySelector('.q-opt-3').value.trim()
        ];
        const correct = parseInt(block.querySelector('.q-correct').value);
        const expl = block.querySelector('.q-expl').value.trim() || "Chưa có giải thích.";

        if (!content || opts.some(o => o === "")) isValid = false;

        questions.push({
            passage: passage,
            content: content,
            options: opts,
            correctAnswer: correct,
            explanation: expl
        });
    });

    if (!isValid) return alert("Vui lòng nhập đủ câu hỏi và 4 đáp án!");

    const newQuiz = {
        id: "QZ-MANUAL-" + Date.now(),
        title: title,
        category: category,
        timeLimit: timeLimit,
        questions: questions,
        isTestOnly: isTestOnly,
        authorId: auth.currentUser ? auth.currentUser.uid : "GUEST" 
    };

    db.collection("quizzes").doc(newQuiz.id).set(newQuiz).then(() => {
        alert("Lưu đề thành công!");
        if(titleEl) titleEl.value = '';
        if(catEl) catEl.value = '';
        if(timeEl) timeEl.value = '';
        if(testEl) testEl.checked = false;
        const mc = document.getElementById('manual-questions-container');
        if(mc) mc.innerHTML = '';
        window.history.pushState({}, '', window.location.pathname);
        switchScreen('home'); 
    }).catch(err => alert("Lỗi lưu trữ: " + err.message));
}
