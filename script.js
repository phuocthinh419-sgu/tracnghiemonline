// --- DỮ LIỆU ĐA LĨNH VỰC CỦA TÀNG KINH CÁC ---
const quizDatabase = [
    {
        id: "QZ-ENG-01",
        title: "Đề Thi Tiếng Anh THPT Quốc Gia",
        category: "Tiếng Anh",
        timeLimit: 120,
        questions: [
            {
                content: "Mark the letter A, B, C, or D: The government has launched a new ________ to promote renewable energy.",
                options: ["initiative", "initiation", "initiator", "initial"],
                correctAnswer: 0,
                hint: "Từ cần điền là một danh từ mang nghĩa 'sáng kiến'.",
                explanation: "'initiative' (sáng kiến) là danh từ phù hợp nhất về mặt ngữ nghĩa."
            }
        ]
    },
    {
        id: "QZ-HIS-01",
        title: "Chiến Dịch Điện Biên Phủ",
        category: "Lịch Sử",
        timeLimit: 120,
        questions: [
            {
                content: "Chiến dịch Điện Biên Phủ lịch sử kết thúc thắng lợi vào ngày tháng năm nào?",
                options: ["30/04/1975", "07/05/1954", "02/09/1945", "20/11/1953"],
                correctAnswer: 1,
                hint: "Tháng 5 năm 1954, tướng de Castries đã phải đầu hàng.",
                explanation: "Tướng de Castries đầu hàng vào chiều ngày 07/05/1954."
            }
        ]
    },
    {
        id: "QZ-SPO-01",
        title: "Kỷ Lục Của Hùm Xám Xứ Bavaria",
        category: "Thể Thao",
        timeLimit: 120,
        questions: [
            {
                content: "Bayern Munich giành cú ăn 6 (Sextuple) lịch sử vào năm nào?",
                options: ["2013", "2020", "1999", "2001"],
                correctAnswer: 1,
                hint: "Dưới thời HLV Hansi Flick, vào năm mà đại dịch Covid-19 bùng phát.",
                explanation: "Bayern Munich giành cú ăn 6 vĩ đại vào năm 2020."
            }
        ]
    }
];

// --- BIẾN TOÀN CỤC ---
let activeQuiz = null; 
let currentQuestionIndex = 0;
let studentName = "";
let isPracticeMode = false;
let isReviewMode = false;
let tabSwitchCount = 0;
let timerInterval;
let timeLeft = 0;
let userAnswers = [];

// --- ÁNH XẠ GIAO DIỆN ---
const screens = {
    home: document.getElementById('home-screen'),
    welcome: document.getElementById('welcome-screen'),
    quiz: document.getElementById('quiz-screen'),
    result: document.getElementById('result-screen')
};

// --- KHỞI TẠO HỆ THỐNG ---
window.onload = () => {
    renderHomeQuizList();
    setupEventListeners();
};

function setupEventListeners() {
    document.getElementById('btn-theme-toggle').addEventListener('click', toggleDarkMode);
    
    // Sửa lỗi điều hướng Trang Chủ
    document.getElementById('btn-back-home').addEventListener('click', () => switchScreen('home'));
    document.getElementById('btn-home').addEventListener('click', () => {
        // Reset lại toàn bộ và về trang chủ thay vì reload trang gây giật lác
        switchScreen('home');
    });
    
    document.getElementById('btn-practice').addEventListener('click', () => startQuiz(true));
    document.getElementById('btn-mock').addEventListener('click', () => startQuiz(false));
    
    document.getElementById('btn-prev').addEventListener('click', () => loadQuestion(currentQuestionIndex - 1));
    document.getElementById('btn-next').addEventListener('click', () => loadQuestion(currentQuestionIndex + 1));
    document.getElementById('btn-submit').addEventListener('click', () => submitQuiz(false));
    
    document.getElementById('btn-review').addEventListener('click', reviewQuiz);
    document.getElementById('btn-hint').addEventListener('click', showHint);

    document.addEventListener('visibilitychange', handleVisibilityChange);
}

function toggleDarkMode() {
    const htmlElement = document.documentElement;
    htmlElement.classList.toggle('dark');
    const icon = document.getElementById('theme-icon');
    if (htmlElement.classList.contains('dark')) {
        icon.classList.replace('fa-moon', 'fa-sun');
    } else {
        icon.classList.replace('fa-sun', 'fa-moon');
    }
}

function switchScreen(screenName) {
    Object.values(screens).forEach(screen => screen.classList.add('hidden'));
    screens[screenName].classList.remove('hidden');
}

function renderHomeQuizList() {
    const container = document.getElementById('quiz-list-container');
    container.innerHTML = '';
    quizDatabase.forEach(quiz => {
        const card = document.createElement('div');
        card.className = 'p-6 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-2xl shadow-sm hover:shadow-lg transition-all cursor-pointer group';
        card.innerHTML = `
            <span class="px-3 py-1 bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-xs font-bold rounded-full uppercase">${quiz.category}</span>
            <h3 class="mt-4 font-academic text-xl font-bold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">${quiz.title}</h3>
            <p class="mt-2 text-sm text-gray-500 dark:text-gray-400"><i class="far fa-clock"></i> ${Math.floor(quiz.timeLimit / 60)} phút • ${quiz.questions.length} câu</p>
        `;
        card.onclick = () => selectQuiz(quiz);
        container.appendChild(card);
    });
}

function selectQuiz(quiz) {
    activeQuiz = quiz;
    document.getElementById('selected-quiz-title').innerText = quiz.title;
    switchScreen('welcome');
}

function startQuiz(practice) {
    const nameInput = document.getElementById('student-name').value.trim();
    if (!nameInput) {
        alert("Bệ hạ (hoặc sĩ tử) vui lòng xưng danh trước khi thi!");
        return;
    }
    
    studentName = nameInput;
    isPracticeMode = practice;
    isReviewMode = false;
    tabSwitchCount = 0;
    
    userAnswers = new Array(activeQuiz.questions.length).fill(null);
    timeLeft = activeQuiz.timeLimit;

    document.getElementById('display-student-name').innerText = studentName;
    document.getElementById('quiz-header-title').innerText = activeQuiz.title;
    document.getElementById('energy-bar-container').classList.remove('hidden');

    switchScreen('quiz');
    loadQuestion(0);
    startTimer();
}

// --- FIX: HIỂN THỊ RÕ ĐÁP ÁN ĐÃ CHỌN ---
function loadQuestion(index) {
    if(index < 0 || index >= activeQuiz.questions.length) return;
    
    const q = activeQuiz.questions[index];
    currentQuestionIndex = index;
    
    document.getElementById('question-counter').innerText = `Câu hỏi ${index + 1} / ${activeQuiz.questions.length}`;
    document.getElementById('question-content').innerHTML = q.content;
    
    const optionsContainer = document.getElementById('options-container');
    optionsContainer.innerHTML = ''; 
    
    const labels = ['A', 'B', 'C', 'D'];
    q.options.forEach((optText, optIndex) => {
        const btn = document.createElement('button');
        // Mặc định là xám nhạt
        btn.className = 'option-btn text-left p-4 rounded-xl flex items-center gap-4 group border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 transition-all';
        btn.innerHTML = `
            <span class="option-label w-10 h-10 flex flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700 font-bold text-gray-500 dark:text-gray-300 transition-colors">${labels[optIndex]}</span>
            <span class="text-lg font-academic text-gray-800 dark:text-gray-200">${optText}</span>
        `;
        
        // Nếu đã chọn thì ép màu đậm lên
        if (userAnswers[index] === optIndex) {
            btn.classList.add('ring-4', 'ring-blue-100', 'border-blue-600', 'bg-blue-50', 'dark:bg-blue-900', 'dark:border-blue-400', 'dark:ring-blue-900');
            btn.querySelector('.option-label').classList.replace('bg-gray-100', 'bg-blue-600');
            btn.querySelector('.option-label').classList.replace('text-gray-500', 'text-white');
            btn.querySelector('.option-label').classList.replace('dark:bg-gray-700', 'dark:bg-blue-600');
            btn.querySelector('.option-label').classList.replace('dark:text-gray-300', 'dark:text-white');
        }

        btn.onclick = () => selectOption(optIndex, btn);
        optionsContainer.appendChild(btn);
    });

    const hintBtn = document.getElementById('btn-hint');
    const hintBox = document.getElementById('hint-box');
    hintBox.classList.add('hidden');
    if (isPracticeMode && !isReviewMode && q.hint && userAnswers[index] === null) {
        hintBtn.classList.remove('hidden');
    } else {
        hintBtn.classList.add('hidden');
    }

    document.getElementById('btn-prev').disabled = index === 0;
    if (index === activeQuiz.questions.length - 1) {
        document.getElementById('btn-next').classList.add('hidden');
        if (!isReviewMode) document.getElementById('btn-submit').classList.remove('hidden');
    } else {
        document.getElementById('btn-next').classList.remove('hidden');
        document.getElementById('btn-submit').classList.add('hidden');
    }

    const explanationBox = document.getElementById('explanation-box');
    if (isReviewMode || (isPracticeMode && userAnswers[index] !== null)) {
        const siblings = optionsContainer.children;
        const userAnswer = userAnswers[index];
        
        siblings[q.correctAnswer].classList.replace('border-gray-200', 'border-green-500');
        siblings[q.correctAnswer].classList.add('bg-green-50', 'dark:bg-green-900/30');
        
        if (userAnswer !== null && userAnswer !== q.correctAnswer) {
            siblings[userAnswer].classList.replace('border-blue-600', 'border-red-500');
            siblings[userAnswer].classList.replace('bg-blue-50', 'bg-red-50');
        }
        for (let el of siblings) el.style.pointerEvents = 'none'; 
        
        document.getElementById('explanation-text').innerText = q.explanation;
        explanationBox.classList.remove('hidden');
    } else {
        explanationBox.classList.add('hidden');
    }
}

function selectOption(optIndex, btnElement) {
    userAnswers[currentQuestionIndex] = optIndex;
    
    // Vẽ lại câu hỏi để cập nhật hiệu ứng chọn màu đậm
    loadQuestion(currentQuestionIndex);

    if (isPracticeMode) {
        document.getElementById('btn-hint').classList.add('hidden');
        document.getElementById('hint-box').classList.add('hidden');
    }
}

function showHint() {
    const q = activeQuiz.questions[currentQuestionIndex];
    const hintBox = document.getElementById('hint-box');
    hintBox.innerText = "💡 Gợi ý: " + q.hint;
    hintBox.classList.remove('hidden');
    document.getElementById('btn-hint').classList.add('hidden');
}

function startTimer() {
    const energyFill = document.getElementById('energy-fill');
    const timeText = document.getElementById('time-text');
    const totalTime = activeQuiz.timeLimit;

    timerInterval = setInterval(() => {
        timeLeft--;
        let percentage = (timeLeft / totalTime) * 100;
        energyFill.style.width = percentage + '%';
        
        let m = Math.floor(timeLeft / 60).toString().padStart(2, '0');
        let s = (timeLeft % 60).toString().padStart(2, '0');
        timeText.innerText = `${m}:${s}`;

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
            alert("Đã hết giờ làm bài! Hệ thống tự động thu bài.");
            submitQuiz(true);
        }
    }, 1000);
}

function handleVisibilityChange() {
    if (document.hidden && !isPracticeMode && !isReviewMode && !screens.quiz.classList.contains('hidden')) {
        tabSwitchCount++;
        if (tabSwitchCount >= 2) {
            alert("VI PHẠM: Rời khỏi màn hình quá 2 lần. Hủy bài thi!");
            submitQuiz(true);
        } else {
            alert("CẢNH BÁO: Không được chuyển tab khi thi thử. Vi phạm lần nữa sẽ bị hủy bài!");
        }
    }
}

function submitQuiz(forceSubmit = false) {
    if (forceSubmit || confirm("Sĩ tử muốn nộp bài?")) {
        clearInterval(timerInterval);
        
        let correctCount = 0;
        activeQuiz.questions.forEach((q, index) => {
            if (userAnswers[index] === q.correctAnswer) correctCount++;
        });

        const percent = Math.round((correctCount / activeQuiz.questions.length) * 100);
        const timeUsed = activeQuiz.timeLimit - (timeLeft > 0 ? timeLeft : 0);
        const m = Math.floor(timeUsed / 60).toString().padStart(2, '0');
        const s = (timeUsed % 60).toString().padStart(2, '0');

        switchScreen('result');
        document.getElementById('result-student-name').innerText = studentName;
        document.getElementById('result-score').innerText = `${correctCount}/${activeQuiz.questions.length}`;
        document.getElementById('result-percent').innerText = `${percent}%`;
        document.getElementById('result-time').innerText = `${m}:${s}`;
    }
}

function reviewQuiz() {
    isReviewMode = true;
    switchScreen('quiz');
    document.getElementById('energy-bar-container').classList.add('hidden');
    document.getElementById('btn-submit').classList.add('hidden');
    document.getElementById('btn-next').classList.remove('hidden');
    loadQuestion(0);
}
