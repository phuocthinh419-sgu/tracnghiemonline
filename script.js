const mockQuiz = {
    id: "DE-TEST-01",
    title: "Bài Thi Khảo Sát Đa Lĩnh Vực",
    timeLimit: 120, 
    questions: [
        {
            id: "q1",
            content: "Mark the letter A, B, C, or D to indicate the correct answer:<br><br>The government has launched a new ________ to promote renewable energy.",
            options: ["initiative", "initiation", "initiator", "initial"],
            correctAnswer: 0,
            explanation: "'initiative' (sáng kiến) là danh từ phù hợp nhất về mặt ngữ nghĩa trong ngữ cảnh này."
        },
        {
            id: "q2",
            content: "Chiến dịch Điện Biên Phủ lịch sử kết thúc thắng lợi, buộc toàn bộ Bộ Tham mưu cứ điểm của Pháp đầu hàng vào ngày tháng năm nào?",
            options: ["30/04/1975", "07/05/1954", "02/09/1945", "20/11/1953"],
            correctAnswer: 1,
            explanation: "Tướng de Castries cùng toàn bộ Bộ Tham mưu tập đoàn cứ điểm Điện Biên Phủ đầu hàng vào chiều ngày 07/05/1954."
        },
        {
            id: "q3",
            content: "Câu lạc bộ bóng đá Bayern Munich đã giành cú ăn 6 (Sextuple) lịch sử vào năm nào dưới thời HLV Hansi Flick?",
            options: ["2013", "2020", "1999", "2001"],
            correctAnswer: 1,
            explanation: "Bayern Munich giành cú ăn 6 vĩ đại vào năm 2020."
        }
    ]
};

let currentQuestionIndex = 0;
let studentName = "";
let isPracticeMode = false;
let isReviewMode = false; // BIẾN MỚI: Trạng thái xem lại
let tabSwitchCount = 0;   // BIẾN MỚI: Đếm số lần chuyển tab
let timerInterval;
let totalTime = mockQuiz.timeLimit;
let timeLeft = totalTime;
let userAnswers = new Array(mockQuiz.questions.length).fill(null);

const screens = {
    welcome: document.getElementById('welcome-screen'),
    quiz: document.getElementById('quiz-screen'),
    result: document.getElementById('result-screen'),
    admin: document.getElementById('admin-zone')
};

// --- SỰ KIỆN KHỞI TẠO ---
document.getElementById('btn-practice').addEventListener('click', () => startQuiz(true));
document.getElementById('btn-mock').addEventListener('click', () => startQuiz(false));
document.getElementById('btn-prev').addEventListener('click', prevQuestion);
document.getElementById('btn-next').addEventListener('click', nextQuestion);
document.getElementById('btn-submit').addEventListener('click', () => submitQuiz(false));
document.getElementById('btn-home').addEventListener('click', () => location.reload());

// BIẾN MỚI: Sự kiện nút Xem chi tiết
document.getElementById('btn-review').addEventListener('click', reviewQuiz);

// BIẾN MỚI: Chuyển đổi Sáng/Tối
document.getElementById('btn-theme-toggle').addEventListener('click', () => {
    document.documentElement.classList.toggle('dark');
    const icon = document.getElementById('theme-icon');
    if (document.documentElement.classList.contains('dark')) {
        icon.classList.replace('fa-moon', 'fa-sun');
    } else {
        icon.classList.replace('fa-sun', 'fa-moon');
    }
});

// BIẾN MỚI: Logic chống chuyển tab (chỉ chạy khi Thi thử và đang làm bài)
document.addEventListener('visibilitychange', () => {
    if (document.hidden && !isPracticeMode && !isReviewMode && !screens.quiz.classList.contains('hidden')) {
        tabSwitchCount++;
        if (tabSwitchCount >= 2) {
            alert("Cảnh báo: Vi phạm quy chế thi (rời khỏi màn hình 2 lần). Hệ thống tự động thu bài!");
            submitQuiz(true); // Ép nộp bài
        } else {
            alert("Cảnh báo: Sĩ tử đang thi thử, không được rời khỏi màn hình làm bài! Vi phạm lần nữa sẽ bị hủy bài.");
        }
    }
});

if (window.location.search.includes('mode=admin')) {
    screens.admin.classList.remove('hidden');
}

// --- LOGIC VẬN HÀNH ---
function startQuiz(practice) {
    const nameInput = document.getElementById('student-name').value.trim();
    if (!nameInput) {
        alert("Bệ hạ (hoặc sĩ tử) vui lòng nhập danh tính trước khi vào trường thi!");
        return;
    }
    studentName = nameInput;
    isPracticeMode = practice;
    screens.welcome.classList.add('hidden');
    screens.quiz.classList.remove('hidden');
    document.getElementById('display-student-name').innerText = studentName;
    document.getElementById('quiz-title').innerText = mockQuiz.title;
    loadQuestion(0);
    startTimer();
}

function loadQuestion(index) {
    const q = mockQuiz.questions[index];
    currentQuestionIndex = index;
    
    document.getElementById('question-counter').innerText = `Câu hỏi ${index + 1} / ${mockQuiz.questions.length}`;
    document.getElementById('question-content').innerHTML = q.content;
    
    const optionsContainer = document.getElementById('options-container');
    optionsContainer.innerHTML = ''; 
    
    const labels = ['A', 'B', 'C', 'D'];
    q.options.forEach((optText, optIndex) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn text-left p-4 rounded-xl flex items-center gap-4 group';
        btn.innerHTML = `
            <span class="option-label w-10 h-10 flex flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 font-bold text-gray-500 transition-colors">${labels[optIndex]}</span>
            <span class="text-lg font-academic text-gray-800 dark:text-gray-200">${optText}</span>
        `;
        if (userAnswers[index] === optIndex) btn.classList.add('selected');
        btn.onclick = () => selectOption(optIndex, btn);
        optionsContainer.appendChild(btn);
    });

    document.getElementById('btn-prev').disabled = index === 0;
    
    if (index === mockQuiz.questions.length - 1) {
        document.getElementById('btn-next').classList.add('hidden');
        if (!isReviewMode) document.getElementById('btn-submit').classList.remove('hidden');
    } else {
        document.getElementById('btn-next').classList.remove('hidden');
        document.getElementById('btn-submit').classList.add('hidden');
    }

    // XỬ LÝ HIỂN THỊ ĐÁP ÁN & GIẢI THÍCH CHO REVIEW MODE VÀ PRACTICE MODE
    const explanationBox = document.getElementById('explanation-box');
    
    if (isReviewMode || (isPracticeMode && userAnswers[index] !== null)) {
        const siblings = optionsContainer.children;
        const userAnswer = userAnswers[index];
        const correctAns = q.correctAnswer;
        
        siblings[correctAns].classList.add('correct'); // Luôn bôi xanh câu đúng
        if (userAnswer !== null && userAnswer !== correctAns) {
            siblings[userAnswer].classList.add('wrong'); // Bôi đỏ nếu chọn sai
        }
        
        // Khóa không cho chọn lại
        for (let el of siblings) el.style.pointerEvents = 'none'; 
        
        document.getElementById('explanation-text').innerText = q.explanation;
        explanationBox.classList.remove('hidden');
    } else {
        explanationBox.classList.add('hidden');
    }
}

function selectOption(optIndex, btnElement) {
    userAnswers[currentQuestionIndex] = optIndex;
    const siblings = document.getElementById('options-container').children;
    for (let el of siblings) {
        el.classList.remove('selected', 'correct', 'wrong');
        if (isPracticeMode) el.style.pointerEvents = 'none'; 
    }
    btnElement.classList.add('selected');

    if (isPracticeMode) {
        const q = mockQuiz.questions[currentQuestionIndex];
        if (optIndex === q.correctAnswer) {
            btnElement.classList.replace('selected', 'correct');
        } else {
            btnElement.classList.replace('selected', 'wrong');
            siblings[q.correctAnswer].classList.add('correct');
        }
        document.getElementById('explanation-text').innerText = q.explanation;
        document.getElementById('explanation-box').classList.remove('hidden');
    }
}

function nextQuestion() {
    if (currentQuestionIndex < mockQuiz.questions.length - 1) loadQuestion(currentQuestionIndex + 1);
}

function prevQuestion() {
    if (currentQuestionIndex > 0) loadQuestion(currentQuestionIndex - 1);
}

function startTimer() {
    const energyFill = document.getElementById('energy-fill');
    const timeText = document.getElementById('time-text');
    const icon = document.getElementById('energy-icon');

    timerInterval = setInterval(() => {
        timeLeft--;
        let percentage = (timeLeft / totalTime) * 100;
        energyFill.style.width = percentage + '%';
        
        let m = Math.floor(timeLeft / 60).toString().padStart(2, '0');
        let s = (timeLeft % 60).toString().padStart(2, '0');
        timeText.innerText = `${m}:${s}`;

        if (percentage <= 15) {
            energyFill.className = 'energy-fill bg-danger pulse-active';
            timeText.className = 'font-mono font-bold text-3xl text-red-600 pulse-active tabular-nums';
            icon.className = 'fas fa-exclamation-triangle icon-runner'; 
        } else if (percentage <= 50) {
            energyFill.className = 'energy-fill bg-warn';
            timeText.className = 'font-mono font-bold text-3xl text-amber-600 tabular-nums';
        } else {
            energyFill.className = 'energy-fill bg-safe';
        }

        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            energyFill.style.width = '0%';
            alert("Đã hết giờ làm bài! Hệ thống tự động thu bài.");
            submitQuiz(true);
        }
    }, 1000);
}

function submitQuiz(forceSubmit = false) {
    if (forceSubmit || confirm("Sĩ tử đã kiểm tra kỹ lưỡng và muốn nộp bài?")) {
        clearInterval(timerInterval);
        processResult();
    }
}

function processResult() {
    let correctCount = 0;
    mockQuiz.questions.forEach((q, index) => {
        if (userAnswers[index] === q.correctAnswer) correctCount++;
    });

    const percent = Math.round((correctCount / mockQuiz.questions.length) * 100);
    const timeUsed = totalTime - (timeLeft > 0 ? timeLeft : 0);
    const m = Math.floor(timeUsed / 60).toString().padStart(2, '0');
    const s = (timeUsed % 60).toString().padStart(2, '0');

    screens.quiz.classList.add('hidden');
    screens.result.classList.remove('hidden');

    document.getElementById('result-student-name').innerText = studentName;
    document.getElementById('result-score').innerText = `${correctCount}/${mockQuiz.questions.length}`;
    document.getElementById('result-percent').innerText = `${percent}%`;
    document.getElementById('result-time').innerText = `${m}:${s}`;
}

// BIẾN MỚI: Hàm Xem lại bài (Review)
function reviewQuiz() {
    isReviewMode = true;
    screens.result.classList.add('hidden');
    screens.quiz.classList.remove('hidden');
    
    // Ẩn thanh thời gian và nút nộp bài khi đang xem lại
    document.querySelector('.energy-track').parentElement.classList.add('hidden');
    document.getElementById('btn-submit').classList.add('hidden');
    
    // Luôn hiện nút "Câu sau" để dễ lướt (nếu không phải câu cuối)
    document.getElementById('btn-next').classList.remove('hidden');
    
    loadQuestion(0); // Bắt đầu xem từ câu 1
}
