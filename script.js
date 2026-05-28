let quizDatabase = [
    {
        id: "QZ-ENG-01", title: "Đề Thi Tiếng Anh THPT", category: "Tiếng Anh", timeLimit: 120,
        questions: [{ content: "Mark the letter A, B, C, or D: The government has launched a new ________.", options: ["initiative", "initiation", "initiator", "initial"], correctAnswer: 0, hint: "Từ cần điền mang nghĩa 'sáng kiến'.", explanation: "'initiative' là sáng kiến." }]
    },
    {
        id: "QZ-HIS-01", title: "Chiến Dịch Điện Biên Phủ", category: "Lịch Sử", timeLimit: 120,
        questions: [{ content: "Chiến dịch Điện Biên Phủ lịch sử kết thúc thắng lợi vào ngày tháng năm nào?", options: ["30/04/1975", "07/05/1954", "02/09/1945", "20/11/1953"], correctAnswer: 1, hint: "Tháng 5 năm 1954.", explanation: "Tướng de Castries đầu hàng vào chiều 07/05/1954." }]
    },
    {
        id: "QZ-SPO-01", title: "Kỷ Lục Bóng Đá", category: "Thể Thao", timeLimit: 120,
        questions: [{ content: "Bayern Munich giành cú ăn 6 (Sextuple) lịch sử vào năm nào?", options: ["2013", "2020", "1999", "2001"], correctAnswer: 1, hint: "Dưới thời HLV Hansi Flick.", explanation: "Bayern Munich giành cú ăn 6 vĩ đại vào năm 2020." }]
    }
];

let activeQuiz = null; 
let currentQuestionIndex = 0;
let studentName = "";
let isPracticeMode = false, isReviewMode = false;
let tabSwitchCount = 0, timerInterval, timeLeft = 0;
let userAnswers = [], flaggedQuestions = [];
let currentRole = 'student';
let currentFilter = 'all'; 

const screens = {
    home: document.getElementById('home-screen'),
    admin: document.getElementById('admin-zone'),
    welcome: document.getElementById('welcome-screen'),
    quiz: document.getElementById('quiz-screen'),
    result: document.getElementById('result-screen')
};

document.addEventListener("DOMContentLoaded", () => { 
    setRole('student'); 
    renderHomeQuizList(); 
    setupEventListeners(); 
});

function setupEventListeners() {
    document.getElementById('role-student').addEventListener('click', () => setRole('student'));
    document.getElementById('role-teacher').addEventListener('click', () => setRole('teacher'));

    document.getElementById('btn-theme-toggle').addEventListener('click', toggleDarkMode);
    document.getElementById('btn-show-admin').addEventListener('click', () => switchScreen('admin'));
    document.getElementById('btn-back-home').addEventListener('click', () => switchScreen('home'));
    document.getElementById('btn-home').addEventListener('click', () => switchScreen('home'));
    // Sự kiện thoát bài thi giữa chừng
    document.getElementById('btn-exit-quiz').addEventListener('click', () => {
        if (confirm("Bạn có chắc chắn muốn thoát? Quá trình làm bài hiện tại sẽ không được lưu lại.")) {
            clearInterval(timerInterval); // Dừng đồng hồ
            switchScreen('home'); // Về thẳng trang chủ
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
}

function toggleDarkMode() {
    document.documentElement.classList.toggle('dark');
    document.getElementById('theme-icon').className = document.documentElement.classList.contains('dark') ? 'fas fa-sun text-xl' : 'fas fa-moon text-xl';
}

function switchScreen(screenName) {
    Object.values(screens).forEach(screen => screen.classList.add('hidden'));
    screens[screenName].classList.remove('hidden');
    if(screenName === 'home') renderHomeQuizList();
}

function renderHomeQuizList() {
    const container = document.getElementById('quiz-list-container');
    container.innerHTML = '';
    quizDatabase.forEach(quiz => {
        const card = document.createElement('div');
        card.className = 'p-6 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-2xl shadow-sm hover:shadow-lg cursor-pointer transition-all';
        card.innerHTML = `<span class="px-3 py-1 bg-blue-100 text-blue-800 text-xs font-bold rounded-full">${quiz.category}</span><h3 class="mt-4 text-xl font-bold dark:text-white hover:text-blue-600">${quiz.title}</h3><p class="mt-2 text-sm text-gray-500">${quiz.questions.length} câu</p>`;
        card.onclick = () => { activeQuiz = quiz; document.getElementById('selected-quiz-title').innerText = quiz.title; switchScreen('welcome'); };
        container.appendChild(card);
    });
}

function startQuiz(practice) {
    if (!document.getElementById('student-name').value.trim()) return alert("Vui lòng nhập họ và tên của bạn trước khi bắt đầu!");
    studentName = document.getElementById('student-name').value.trim();
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
        btnFlag.classList.replace('bg-yellow-100', 'bg-yellow-400');
        btnFlag.innerHTML = `<i class="fas fa-flag"></i> Đã phân vân`;
    } else {
        btnFlag.classList.replace('bg-yellow-400', 'bg-yellow-100');
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
        siblings[q.correctAnswer].classList.add('bg-green-50');
        if (userAnswers[index] !== null && userAnswers[index] !== q.correctAnswer) {
            siblings[userAnswers[index]].classList.replace('border-blue-600', 'border-red-500');
            siblings[userAnswers[index]].classList.add('bg-red-50');
        }
        for (let el of siblings) el.style.pointerEvents = 'none';
        
        document.getElementById('explanation-text').innerText = q.explanation || "Chưa có giải thích.";
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
            alert("Đã hết giờ làm bài! Hệ thống tự động thu bài.");
            submitQuiz(true);
        }
    }, 1000);
}

function handleVisibilityChange() {
    if (document.hidden && !isPracticeMode && !isReviewMode && !screens.quiz.classList.contains('hidden')) {
        if (++tabSwitchCount >= 2) { 
            alert("CẢNH BÁO VI PHẠM: Rời khỏi màn hình làm bài quá 2 lần. Hệ thống tự động hủy và thu bài thi!"); 
            submitQuiz(true); 
        } 
        else alert("CẢNH BÁO: Không được chuyển tab hoặc rời khỏi màn hình khi đang thi thử. Vi phạm lần nữa sẽ bị hủy bài thi!");
    }
}

function submitQuiz(force) {
    if (force || confirm("Bạn có chắc chắn muốn nộp bài?")) {
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

function handleDocxImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const statusDiv = document.getElementById('import-status');
    statusDiv.classList.remove('hidden');
    statusDiv.innerText = "Đang xử lý đề thi, vui lòng đợi giây lát...";
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
                        explanation: "Tạo tự động từ tệp DOCX."
                    });
                }
            });

            if(parsedQuestions.length > 0) {
                quizDatabase.push({
                    id: "QZ-DOCX-" + Date.now(),
                    title: file.name.replace('.docx', ''),
                    category: "Đề Tự Tạo",
                    timeLimit: 1800,
                    questions: parsedQuestions
                });
                renderHomeQuizList(); // Cập nhật lại danh sách ngoài trang chủ
                statusDiv.innerText = `Hoàn tất! Đã nhận diện thành công ${parsedQuestions.length} câu hỏi.`;
                statusDiv.className = "mt-4 text-center font-bold text-green-600";
            } else {
                statusDiv.innerText = "Lỗi định dạng: Không tìm thấy cấu trúc Câu 1:, A., B., C., D.";
                statusDiv.className = "mt-4 text-center font-bold text-red-600";
            }
        }).catch(err => {
            statusDiv.innerText = "Có lỗi xảy ra khi đọc tệp.";
        });
    };
    reader.readAsArrayBuffer(file);
}
