// --- 1. CẤU HÌNH FIREBASE ---
const firebaseConfig = {
    apiKey: "AIzaSyDyIvKhuxDw8uP1RmMutvdGd1o042XKYAM",
    authDomain: "multiple-choice-6704b.firebaseapp.com",
    projectId: "multiple-choice-6704b",
    storageBucket: "multiple-choice-6704b.firebasestorage.app",
    messagingSenderId: "1093935852039",
    appId: "1:1093935852039:web:8a0788e9252285b39518a2"
};

// Khởi tạo Firebase
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

const screens = {
    auth: document.getElementById('auth-screen'),
    home: document.getElementById('home-screen'),
    admin: document.getElementById('admin-zone'),
    welcome: document.getElementById('welcome-screen'),
    quiz: document.getElementById('quiz-screen'),
    result: document.getElementById('result-screen')
};

// --- 3. THEO DÕI TRẠNG THÁI TÀI KHOẢN & XỬ LÝ LINK CHIA SẺ ---
document.addEventListener("DOMContentLoaded", () => { 
    setupEventListeners(); 
    
    // Lắng nghe trạng thái đăng nhập
    auth.onAuthStateChanged((user) => {
        if (user) {
            if (user.displayName) {
                document.getElementById('student-name').value = user.displayName;
            }
            setRole('student');
            
            // Tải danh sách đề thi ngầm
            fetchQuizzesFromFirebase(); 

            // Kiểm tra link chia sẻ (Sửa lỗi Race Condition tại đây)
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
    db.collection("quizzes").onSnapshot((snapshot) => {
        quizDatabase = [];
        snapshot.forEach((doc) => {
            quizDatabase.push(doc.data());
        });
        renderHomeQuizList(); 
    }, (error) => {
        console.error("Lỗi khi tải dữ liệu từ Firebase: ", error);
    });
}

// Truy vấn trực tiếp lên Cloud để tránh lỗi "Đề thi không tồn tại"
function checkUrlForSharedQuiz(quizId) {
    db.collection("quizzes").doc(quizId).get().then((doc) => {
        if (doc.exists) {
            activeQuiz = doc.data();
            document.getElementById('selected-quiz-title').innerText = activeQuiz.title;
            switchScreen('welcome');
        } else {
            alert("Đề thi này không tồn tại hoặc đã bị gỡ bỏ khỏi hệ thống!");
            switchScreen('home');
        }
        // Xóa mã đề khỏi URL để không bị lặp lại lỗi khi F5
        window.history.replaceState({}, document.title, window.location.pathname);
    }).catch(err => {
        console.error("Lỗi khi truy xuất đề thi từ link: ", err);
        switchScreen('home');
    });
}

function copyLink(link) {
    navigator.clipboard.writeText(link).then(() => {
        alert("Đã sao chép liên kết thành công! Bạn có thể dán để gửi liên kết này cho học sinh.");
    });
}

// --- 4. LOGIC XỬ LÝ ĐĂNG NHẬP / ĐĂNG KÝ / ĐĂNG XUẤT ---
function setupEventListeners() {
    document.getElementById('btn-auth-toggle').addEventListener('click', () => toggleAuthMode(!isLoginMode));
    document.getElementById('btn-auth-submit').addEventListener('click', handleAuthSubmit);
    document.getElementById('btn-logout').addEventListener('click', () => {
        if(confirm("Bạn có chắc chắn muốn đăng xuất tài khoản?")) auth.signOut();
    });

    document.getElementById('role-student').addEventListener('click', () => setRole('student'));
    document.getElementById('role-teacher').addEventListener('click', () => setRole('teacher'));
    document.getElementById('btn-theme-toggle').addEventListener('click', toggleDarkMode);
    document.getElementById('btn-show-admin').addEventListener('click', () => switchScreen('admin'));
    
    const goHome = () => { window.history.pushState({}, '', window.location.pathname); switchScreen('home'); };
    document.getElementById('btn-back-home').addEventListener('click', goHome);
    document.getElementById('btn-home').addEventListener('click', goHome);
    
    document.getElementById('btn-exit-quiz').addEventListener('click', () => {
        if (confirm("Bạn có chắc chắn muốn thoát? Toàn bộ kết quả làm bài của lượt này sẽ không được lưu lại.")) {
            clearInterval(timerInterval); goHome();
        }
    });

    document.getElementById('btn-practice').addEventListener('click', () => startQuiz(true));
    document.getElementById('btn-mock').addEventListener('click', () => startQuiz(false));
    document.getElementById('btn-prev').addEventListener('click', () => loadQuestion(currentQuestionIndex - 1));
    document.getElementById('btn-next').addEventListener('click', () => loadQuestion(currentQuestionIndex + 1));
    document.getElementById('btn-submit').addEventListener('click', () => submitQuiz(false));
    document.getElementById('btn-review').addEventListener('click', reviewQuiz);
    document.getElementById('btn-hint').addEventListener('click', () => document.getElementById('hint-box').classList.remove('hidden'));
    document.getElementById('btn-flag').addEventListener('click', toggleFlag);
    document.getElementById('upload-docx').addEventListener('change', handleDocxImport);
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
}

function toggleAuthMode(loginMode) {
    isLoginMode = loginMode;
    const title = document.getElementById('auth-title');
    const btnSubmit = document.getElementById('btn-auth-submit');
    const toggleMsg = document.getElementById('auth-toggle-msg');
    const toggleBtn = document.getElementById('btn-auth-toggle');
    const nameField = document.getElementById('div-auth-name');

    document.getElementById('auth-email').value = '';
    document.getElementById('auth-password').value = '';
    document.getElementById('auth-name').value = '';

    if (isLoginMode) {
        title.innerText = "Đăng Nhập Hệ Thống";
        btnSubmit.innerText = "Đăng Nhập";
        toggleMsg.innerText = "Chưa có tài khoản?";
        toggleBtn.innerText = "Đăng ký ngay";
        nameField.classList.add('hidden');
    } else {
        title.innerText = "Đăng Ký Tài Khoản";
        btnSubmit.innerText = "Tạo Tài Khoản";
        toggleMsg.innerText = "Đã có tài khoản?";
        toggleBtn.innerText = "Đăng nhập ngay";
        nameField.classList.remove('hidden');
    }
}

function handleAuthSubmit() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value.trim();
    const name = document.getElementById('auth-name').value.trim();

    if (!email || !password) return alert("Vui lòng nhập đầy đủ Email và Mật khẩu!");

    if (isLoginMode) {
        auth.signInWithEmailAndPassword(email, password)
            .catch(err => alert("Đăng nhập thất bại: " + err.message));
    } else {
        if (!name) return alert("Vui lòng nhập Họ và tên để thiết lập hồ sơ người dùng!");
        
        auth.createUserWithEmailAndPassword(email, password)
            .then((result) => {
                return result.user.updateProfile({ displayName: name });
            })
            .then(() => {
                alert("Đăng ký tài khoản mới thành công!");
                auth.currentUser.reload();
            })
            .catch(err => alert("Đăng ký thất bại: " + err.message));
    }
}

// --- 5. ĐIỀU HƯỚNG MÀN HÌNH & PHÂN QUYỀN ---
function setRole(role) {
    currentRole = role;
    const btnStudent = document.getElementById('role-student');
    const btnTeacher = document.getElementById('role-teacher');
    const btnAdmin = document.getElementById('btn-show-admin');

    btnStudent.className = 'px-8 py-2.5 rounded-lg font-bold transition-all text-gray-500 hover:text-gray-700 dark:text-gray-400';
    btnTeacher.className = 'px-8 py-2.5 rounded-lg font-bold transition-all text-gray-500 hover:text-gray-700 dark:text-gray-400';

    if (role === 'student') {
        btnStudent.classList.add('bg-white', 'shadow-md', 'text-blue-900', 'dark:bg-gray-800', 'dark:text-white');
        btnAdmin.classList.add('hidden');
    } else {
        btnTeacher.classList.add('bg-white', 'shadow-md', 'text-blue-900', 'dark:bg-gray-800', 'dark:text-white');
        btnAdmin.classList.remove('hidden');
        btnAdmin.classList.add('animate-bounce');
        setTimeout(() => btnAdmin.classList.remove('animate-bounce'), 1500);
    }
    renderHomeQuizList(); 
}

function toggleDarkMode() {
    document.documentElement.classList.toggle('dark');
    document.getElementById('theme-icon').className = document.documentElement.classList.contains('dark') ? 'fas fa-sun text-xl' : 'fas fa-moon text-xl';
}

function switchScreen(screenName) {
    Object.values(screens).forEach(screen => screen.classList.add('hidden'));
    screens[screenName].classList.remove('hidden');
    if(screenName === 'home') renderHomeQuizList();
    if(screenName === 'admin') {
        switchAdminTab('docx');
        document.getElementById('manual-questions-container').innerHTML = '';
    }
}

// --- 6. HIỂN THỊ DANH SÁCH ĐỀ THI ---
function renderHomeQuizList() {
    const container = document.getElementById('quiz-list-container');
    container.innerHTML = '';
    
    if (quizDatabase.length === 0) {
        container.innerHTML = '<p class="col-span-full text-center text-gray-500 py-8">Chưa có đề thi nào trên hệ thống đám mây. Vui lòng chuyển sang vai trò Giáo viên để tạo đề mới.</p>';
        return;
    }

    const categories = [...new Set(quizDatabase.map(q => q.category))];
    categories.forEach(category => {
        const folderHeader = document.createElement('div');
        folderHeader.className = 'col-span-full mt-6 mb-2 border-b-2 border-gray-200 dark:border-gray-700 pb-2 flex items-center gap-3';
        folderHeader.innerHTML = `<i class="fas fa-folder-open text-amber-500 text-2xl"></i> <h2 class="text-2xl font-bold text-gray-800 dark:text-white">${category}</h2>`;
        container.appendChild(folderHeader);

        const quizzesInFolder = quizDatabase.filter(q => q.category === category);
        quizzesInFolder.forEach(quiz => {
            const card = document.createElement('div');
            card.className = 'relative p-6 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-2xl shadow-sm hover:shadow-lg transition-all group';
            
            let actionBtnsHTML = '';
            if (currentRole === 'teacher') {
                const shareLink = `${window.location.origin}${window.location.pathname}?quiz=${quiz.id}`;
                actionBtnsHTML = `
                    <button onclick="copyLink('${shareLink}')" class="absolute top-4 right-14 text-gray-400 hover:text-blue-500 transition-colors bg-gray-100 dark:bg-gray-800 rounded-full w-8 h-8 flex items-center justify-center shadow-sm" title="Sao chép liên kết chia sẻ đề thi"><i class="fas fa-link"></i></button>
                    <button onclick="deleteQuiz('${quiz.id}')" class="absolute top-4 right-4 text-gray-400 hover:text-red-500 transition-colors bg-gray-100 dark:bg-gray-800 rounded-full w-8 h-8 flex items-center justify-center shadow-sm" title="Xóa đề thi này"><i class="fas fa-trash-alt"></i></button>
                `;
            }

            card.innerHTML = `
                ${actionBtnsHTML}
                <span class="px-3 py-1 bg-blue-100 text-blue-800 text-xs font-bold rounded-full">${quiz.category}</span>
                <h3 class="mt-4 text-xl font-bold dark:text-white cursor-pointer hover:text-blue-600" onclick="selectQuiz('${quiz.id}')">${quiz.title}</h3>
                <p class="mt-2 text-sm text-gray-500"><i class="far fa-clock"></i> ${Math.floor(quiz.timeLimit / 60)} phút • ${quiz.questions.length} câu hỏi</p>
            `;
            container.appendChild(card);
        });
    });
}

function selectQuiz(quizId) {
    activeQuiz = quizDatabase.find(q => q.id === quizId);
    if (!activeQuiz) {
        alert("Đề thi này không tồn tại hoặc đã bị gỡ bỏ khỏi hệ thống!");
        return;
    }
    document.getElementById('selected-quiz-title').innerText = activeQuiz.title;
    switchScreen('welcome');
}

function deleteQuiz(quizId) {
    if (confirm("Xác nhận xóa vĩnh viễn đề thi này khỏi hệ thống cơ sở dữ liệu?")) {
        db.collection("quizzes").doc(quizId).delete().catch(err => alert("Lỗi khi xóa dữ liệu: " + err));
    }
}

// --- 7. LOGIC THI VÀ LUỒNG BỘ LỌC ĐỀ ---
function startQuiz(practice) {
    const nameInput = document.getElementById('student-name').value.trim();
    if (!nameInput) return alert("Vui lòng nhập họ và tên của bạn trước khi bắt đầu làm bài!");
    
    studentName = nameInput;
    isPracticeMode = practice; isReviewMode = false; tabSwitchCount = 0;
    userAnswers = new Array(activeQuiz.questions.length).fill(null);
    flaggedQuestions = new Array(activeQuiz.questions.length).fill(false);
    timeLeft = activeQuiz.timeLimit;
    
    currentFilter = 'all';
    document.getElementById('filter-tabs-practice').classList.replace('hidden', 'grid');
    document.getElementById('filter-tabs-review').classList.replace('grid', 'hidden');
    resetFilterButtons(document.getElementById('filter-tabs-practice'));

    document.getElementById('display-student-name').innerText = studentName;
    document.getElementById('quiz-header-title').innerText = activeQuiz.title;
    document.getElementById('energy-bar-container').classList.remove('hidden');

    switchScreen('quiz');
    loadQuestion(0);
    startTimer();
}

function setFilter(type, btnElement) {
    currentFilter = type;
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-1'));
    btnElement.classList.add('ring-2', 'ring-blue-500', 'ring-offset-1');
    renderNavigator();
}

function resetFilterButtons(container) {
    container.querySelectorAll('.filter-btn').forEach((btn, index) => {
        btn.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-1');
        if (index === 0) btn.classList.add('ring-2', 'ring-blue-500', 'ring-offset-1'); 
    });
}

function renderNavigator() {
    const grid = document.getElementById('navigator-grid');
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
    
    document.getElementById('question-counter').innerText = `Câu hỏi ${index + 1} / ${activeQuiz.questions.length}`;
    document.getElementById('question-content').innerHTML = q.content;
    
    const btnFlag = document.getElementById('btn-flag');
    if (flaggedQuestions[index]) {
        btnFlag.className = 'flex items-center gap-2 px-4 py-2 bg-yellow-400 text-yellow-900 rounded-lg font-bold transition-colors border border-yellow-500';
        btnFlag.innerHTML = `<i class="fas fa-flag"></i> Đang phân vân`;
    } else {
        btnFlag.className = 'flex items-center gap-2 px-4 py-2 bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-400 rounded-lg font-bold hover:bg-yellow-200 transition-colors border border-yellow-300 dark:border-yellow-700';
        btnFlag.innerHTML = `<i class="far fa-flag"></i> Đánh dấu phân vân`;
    }
    
    const optionsContainer = document.getElementById('options-container');
    optionsContainer.innerHTML = ''; 
    const labels = ['A', 'B', 'C', 'D'];
    q.options.forEach((optText, optIndex) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn text-left p-4 rounded-xl flex items-center gap-4 border-2 border-gray-200 bg-white dark:bg-gray-800 dark:border-gray-600 transition-all';
        btn.innerHTML = `<span class="option-label w-10 h-10 flex items-center justify-center rounded-lg bg-gray-100 font-bold text-gray-500">${labels[optIndex]}</span><span class="text-lg font-academic dark:text-gray-200">${optText}</span>`;
        
        if (userAnswers[index] === optIndex) {
            btn.classList.add('ring-4', 'ring-blue-100', 'border-blue-600', 'bg-blue-50', 'dark:bg-blue-900');
            btn.querySelector('.option-label').classList.replace('bg-gray-100', 'bg-blue-600');
            btn.querySelector('.option-label').classList.replace('text-gray-500', 'text-white');
        }
        btn.onclick = () => { userAnswers[currentQuestionIndex] = optIndex; loadQuestion(currentQuestionIndex); };
        optionsContainer.appendChild(btn);
    });

    const hintBtn = document.getElementById('btn-hint');
    const hintBox = document.getElementById('hint-box');
    hintBox.classList.add('hidden');
    if (isPracticeMode && !isReviewMode && q.hint && userAnswers[index] === null) hintBtn.classList.remove('hidden');
    else hintBtn.classList.add('hidden');

    document.getElementById('btn-prev').disabled = index === 0;
    document.getElementById('btn-next').classList.toggle('hidden', index === activeQuiz.questions.length - 1);
    document.getElementById('btn-submit').classList.toggle('hidden', index !== activeQuiz.questions.length - 1 || isReviewMode);

    const explanationBox = document.getElementById('explanation-box');
    if (isReviewMode || (isPracticeMode && userAnswers[index] !== null)) {
        const siblings = optionsContainer.children;
        siblings[q.correctAnswer].classList.replace('border-gray-200', 'border-green-500');
        siblings[q.correctAnswer].classList.add('bg-green-50', 'dark:bg-green-900/30');
        if (userAnswers[index] !== null && userAnswers[index] !== q.correctAnswer) {
            siblings[userAnswers[index]].classList.replace('border-blue-600', 'border-red-500');
            siblings[userAnswers[index]].classList.add('bg-red-50', 'dark:bg-red-900/30');
        }
        for (let el of siblings) el.style.pointerEvents = 'none';
        
        document.getElementById('explanation-text').innerText = q.explanation || "Chưa có lời giải thích chi tiết cho câu hỏi này.";
        explanationBox.classList.remove('hidden');
        hintBtn.classList.add('hidden');
    } else {
        explanationBox.classList.add('hidden');
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
        energyFill.style.width = percentage + '%';
        
        timeText.innerText = `${Math.floor(timeLeft / 60).toString().padStart(2, '0')}:${(timeLeft % 60).toString().padStart(2, '0')}`;

        if (percentage <= 15) {
            energyFill.className = 'energy-fill bg-danger pulse-active';
            timeText.className = 'font-mono font-bold text-3xl text-red-600 tabular-nums';
        } else if (percentage <= 50) {
            energyFill.className = 'energy-fill bg-warn';
            timeText.className = 'font-mono font-bold text-3xl text-amber-600 tabular-nums';
        } else {
            energyFill.className = 'energy-fill bg-safe';
            timeText.className = 'font-mono font-bold text-3xl text-blue-900 dark:text-white tabular-nums';
        }

        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            alert("Thời gian làm bài đã kết thúc! Hệ thống sẽ tự động nộp bài làm của bạn.");
            submitQuiz(true);
        }
    }, 1000);
}

function handleVisibilityChange() {
    if (document.hidden && !isPracticeMode && !isReviewMode && !screens.quiz.classList.contains('hidden')) {
        if (++tabSwitchCount >= 2) { 
            alert("VI PHẠM QUY CHẾ: Bạn đã rời khỏi màn hình làm bài thi quá 2 lần. Hệ thống tự động khóa và thu bài làm!"); 
            submitQuiz(true); 
        } 
        else {
            alert("CẢNH BÁO QUAN TRỌNG: Không được chuyển tab hoặc rời khỏi trình duyệt khi đang trong chế độ thi thử. Vi phạm lần kế tiếp hệ thống sẽ hủy bài thi!");
        }
    }
}

function submitQuiz(force) {
    if (force || confirm("Bạn có chắc chắn muốn nộp bài làm hiện tại không?")) {
        clearInterval(timerInterval);
        let correctCount = userAnswers.filter((ans, i) => ans === activeQuiz.questions[i].correctAnswer).length;
        switchScreen('result');
        document.getElementById('result-score').innerText = `${correctCount}/${activeQuiz.questions.length}`;
        document.getElementById('result-percent').innerText = `${Math.round((correctCount / activeQuiz.questions.length) * 100)}%`;
        
        const timeUsed = activeQuiz.timeLimit - (timeLeft > 0 ? timeLeft : 0);
        document.getElementById('result-time').innerText = `${Math.floor(timeUsed / 60).toString().padStart(2, '0')}:${(timeUsed % 60).toString().padStart(2, '0')}`;
    }
}

function reviewQuiz() {
    isReviewMode = true;
    switchScreen('quiz');
    document.getElementById('energy-bar-container').classList.add('hidden');
    document.getElementById('btn-submit').classList.add('hidden');
    
    currentFilter = 'all';
    document.getElementById('filter-tabs-practice').classList.replace('grid', 'hidden');
    document.getElementById('filter-tabs-review').classList.replace('hidden', 'grid');
    resetFilterButtons(document.getElementById('filter-tabs-review'));

    loadQuestion(0);
}

// --- 8. LOGIC SOẠN ĐỀ (ADMIN ZONE) ---
function switchAdminTab(tabName) {
    const btnDocx = document.getElementById('tab-docx');
    const btnManual = document.getElementById('tab-manual');
    const panelDocx = document.getElementById('panel-docx');
    const panelManual = document.getElementById('panel-manual');

    if (tabName === 'docx') {
        btnDocx.className = 'px-4 py-2 font-bold rounded-lg bg-blue-100 text-blue-700';
        btnManual.className = 'px-4 py-2 font-bold rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700';
        panelDocx.classList.replace('hidden', 'block');
        panelManual.classList.replace('block', 'hidden');
    } else {
        btnManual.className = 'px-4 py-2 font-bold rounded-lg bg-blue-100 text-blue-700';
        btnDocx.className = 'px-4 py-2 font-bold rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700';
        panelManual.classList.replace('hidden', 'block');
        panelDocx.classList.replace('block', 'hidden');
    }
}

function handleDocxImport(event) {
    const file = event.target.files[0];
    const categoryInput = document.getElementById('docx-category').value.trim() || 'Chưa phân loại';
    if (!file) return;
    
    const statusDiv = document.getElementById('import-status');
    statusDiv.classList.remove('hidden');
    statusDiv.innerText = "Hệ thống đang kết nối máy chủ Firebase và xử lý tệp tin...";
    statusDiv.className = "mt-4 text-center font-bold text-amber-600";

    const reader = new FileReader();
    reader.onload = function(e) {
        mammoth.extractRawText({arrayBuffer: e.target.result}).then(function(result) {
            const text = result.value;
            const questionsRaw = text.split(/Câu \d+:/).filter(q => q.trim().length > 0);
            let parsedQuestions = [];
            
            questionsRaw.forEach(qText => {
                const parts = qText.split(/[A-D]\./);
                if(parts.length >= 5) {
                    parsedQuestions.push({
                        content: parts[0].trim(),
                        options: [parts[1].trim(), parts[2].trim(), parts[3].trim(), parts[4].split("Đáp án")[0].trim()],
                        correctAnswer: 0, 
                        explanation: "Tạo tự động từ tệp DOCX Word."
                    });
                }
            });

            if(parsedQuestions.length > 0) {
                const newQuiz = {
                    id: "QZ-DOCX-" + Date.now(),
                    title: file.name.replace('.docx', ''),
                    category: categoryInput,
                    timeLimit: 1800, 
                    questions: parsedQuestions
                };
                
                db.collection("quizzes").doc(newQuiz.id).set(newQuiz).then(() => {
                    document.getElementById('docx-category').value = ''; 
                    statusDiv.innerText = `Hoàn tất! Đã lưu đề thi mới lên đám mây trong thư mục "${categoryInput}".`;
                    statusDiv.className = "mt-4 text-center font-bold text-green-600";
                }).catch(err => {
                    statusDiv.innerText = "Lỗi đường truyền Firebase: " + err;
                    statusDiv.className = "mt-4 text-center font-bold text-red-600";
                });
                
            } else {
                statusDiv.innerText = "Lỗi cấu trúc tệp Word: Hệ thống không tìm thấy định dạng chuẩn 'Câu 1:', 'A.', 'B.', 'C.', 'D.'";
                statusDiv.className = "mt-4 text-center font-bold text-red-600";
            }
        }).catch(err => {
            statusDiv.innerText = "Đã xảy ra lỗi không xác định trong quá trình bóc tách dữ liệu.";
        });
    };
    reader.readAsArrayBuffer(file);
}

function addManualQuestionForm() {
    const container = document.getElementById('manual-questions-container');
    const qDiv = document.createElement('div');
    qDiv.className = 'manual-q-block p-6 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl relative';
    qDiv.innerHTML = `
        <button onclick="this.parentElement.remove()" class="absolute top-4 right-4 text-gray-400 hover:text-red-500 transition-colors"><i class="fas fa-times text-xl"></i></button>
        <h4 class="font-bold mb-4 dark:text-white text-blue-600">Nội dung câu hỏi nhập liệu</h4>
        <textarea placeholder="Nhập nội dung câu hỏi chính tại đây..." class="q-content w-full p-3 mb-4 border rounded outline-none focus:border-blue-500 dark:bg-gray-800 dark:text-white dark:border-gray-600" rows="2"></textarea>
        <div class="grid grid-cols-2 gap-3 mb-4">
            <input type="text" placeholder="Lựa chọn A" class="q-opt-0 p-2 border rounded dark:bg-gray-800 dark:text-white dark:border-gray-600 outline-none">
            <input type="text" placeholder="Lựa chọn B" class="q-opt-1 p-2 border rounded dark:bg-gray-800 dark:text-white dark:border-gray-600 outline-none">
            <input type="text" placeholder="Lựa chọn C" class="q-opt-2 p-2 border rounded dark:bg-gray-800 dark:text-white dark:border-gray-600 outline-none">
            <input type="text" placeholder="Lựa chọn D" class="q-opt-3 p-2 border rounded dark:bg-gray-800 dark:text-white dark:border-gray-600 outline-none">
        </div>
        <div class="flex gap-4 items-center">
            <label class="font-bold dark:text-gray-300">Xác định đáp án chính xác:</label>
            <select class="q-correct p-2 border rounded outline-none dark:bg-gray-800 dark:text-white dark:border-gray-600">
                <option value="0">A</option><option value="1">B</option><option value="2">C</option><option value="3">D</option>
            </select>
        </div>
        <input type="text" placeholder="Nhập lời giải thích đáp án (Nếu có)..." class="q-expl w-full p-2 mt-4 border rounded outline-none dark:bg-gray-800 dark:text-white dark:border-gray-600">
    `;
    container.appendChild(qDiv);
}

function saveManualQuiz() {
    const title = document.getElementById('manual-title').value.trim();
    const category = document.getElementById('manual-category').value.trim();
    const manualMinutes = document.getElementById('manual-time').value;
    const timeLimit = parseInt(manualMinutes) * 60; 

    if (!title || !category || isNaN(timeLimit) || timeLimit <= 0) {
        return alert("Vui lòng điền đầy đủ và chính xác tên đề thi, tên thư mục môn học cùng thời gian làm bài!");
    }

    const qBlocks = document.querySelectorAll('.manual-q-block');
    if (qBlocks.length === 0) return alert("Vui lòng tạo ít nhất 1 khối câu hỏi trước khi lưu đề!");

    let questions = [];
    let isValid = true;

    qBlocks.forEach(block => {
        const content = block.querySelector('.q-content').value.trim();
        const opts = [
            block.querySelector('.q-opt-0').value.trim(),
            block.querySelector('.q-opt-1').value.trim(),
            block.querySelector('.q-opt-2').value.trim(),
            block.querySelector('.q-opt-3').value.trim()
        ];
        const correct = parseInt(block.querySelector('.q-correct').value);
        const expl = block.querySelector('.q-expl').value.trim() || "Chưa có giải thích cụ thể cho câu hỏi này.";

        if (!content || opts.some(o => o === "")) isValid = false;

        questions.push({
            content: content,
            options: opts,
            correctAnswer: correct,
            explanation: expl
        });
    });

    if (!isValid) return alert("Vui lòng nhập đầy đủ câu hỏi và toàn bộ 4 đáp án lựa chọn!");

    const newQuiz = {
        id: "QZ-MANUAL-" + Date.now(),
        title: title,
        category: category,
        timeLimit: timeLimit,
        questions: questions
    };

    db.collection("quizzes").doc(newQuiz.id).set(newQuiz).then(() => {
        alert(`Đề thi mới đã được lưu trữ thành công lên máy chủ đám mây tại thư mục môn học: "${category}".`);
        document.getElementById('manual-title').value = '';
        document.getElementById('manual-category').value = '';
        document.getElementById('manual-time').value = '';
        document.getElementById('manual-questions-container').innerHTML = '';
        window.history.pushState({}, '', window.location.pathname);
        switchScreen('home'); 
    }).catch(err => alert("Lỗi kết nối lưu trữ: " + err));
}
