/* Tệp: script.js */

// --- DỮ LIỆU GIẢ LẬP (Sẽ thay thế bằng Firebase sau) ---
const mockQuiz = {
    id: "DE-TEST-01",
    title: "Bài Thi Khảo Sát Đa Lĩnh Vực",
    timeLimit: 120, // 120 giây (2 phút) để bệ hạ test nhanh
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
            explanation: "Bayern Munich giành cú ăn 6 vĩ đại vào năm 2020 (Bao gồm Bundesliga, Cúp QG, Champions League, Siêu cúp Đức, Siêu cúp châu Âu, FIFA Club World Cup)."
        }
    ]
};

// --- BIẾN TRẠNG THÁI HỆ THỐNG ---
let currentQuestionIndex = 0;
let studentName = "";
let isPracticeMode = false;
let timerInterval;
let totalTime = mockQuiz.timeLimit;
let timeLeft = totalTime;
let userAnswers = new Array(mockQuiz.questions.length).fill(null); // Lưu đáp án sĩ tử chọn

// --- KẾT NỐI DOM GIAO DIỆN ---
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
document.getElementById('btn-submit').addEventListener('click', submitQuiz);
document.getElementById('btn-home').addEventListener('click', () => location.reload());

// Kiểm tra nếu url có ?mode=admin thì hiện khu vực bệ hạ
if (window.location.search.includes('mode=admin')) {
    screens.admin.classList.remove('hidden');
}

// --- LOGIC VẬN HÀNH ---

function startQuiz(practice) {
    const nameInput = document.getElementById('student-name').value.trim();
    if (!nameInput) {
        alert("Bạn hãy vui lòng nhập danh tính trước khi vào trường thi!");
        return;
    }
    
    studentName = nameInput;
    isPracticeMode = practice;
    
    // Đổi màn hình
    screens.welcome.classList.add('hidden');
    screens.quiz.classList.remove('hidden');
    
    // Cài đặt thông tin đề
    document.getElementById('display-student-name').innerText = studentName;
    document.getElementById('quiz-title').innerText = mockQuiz.title;
    
    // Tải câu hỏi đầu tiên & Bắt đầu tính giờ
    loadQuestion(0);
    startTimer();
}

function loadQuestion(index) {
    const q = mockQuiz.questions[index];
    currentQuestionIndex = index;
    
    // Cập nhật bộ đếm
    document.getElementById('question-counter').innerText = `Câu hỏi ${index + 1} / ${mockQuiz.questions.length}`;
    
    // Tải nội dung câu hỏi
    document.getElementById('question-content').innerHTML = q.content;
    
    // Tải đáp án
    const optionsContainer = document.getElementById('options-container');
    optionsContainer.innerHTML = ''; // Xóa đáp án cũ
    
    const labels = ['A', 'B', 'C', 'D'];
    q.options.forEach((optText, optIndex) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn text-left p-4 rounded-xl flex items-center gap-4 group';
        btn.innerHTML = `
            <span class="option-label w-10 h-10 flex flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 font-bold text-gray-500 transition-colors">${labels[optIndex]}</span>
            <span class="text-lg font-academic text-gray-800">${optText}</span>
        `;
        
        // Phục hồi trạng thái nếu đã chọn trước đó
        if (userAnswers[index] === optIndex) {
            btn.classList.add('selected');
        }
        
        btn.onclick = () => selectOption(optIndex, btn);
        optionsContainer.appendChild(btn);
    });

    // Ẩn/Hiện nút điều hướng
    document.getElementById('btn-prev').disabled = index === 0;
    
    if (index === mockQuiz.questions.length - 1) {
        document.getElementById('btn-next').classList.add('hidden');
        document.getElementById('btn-submit').classList.remove('hidden');
    } else {
        document.getElementById('btn-next').classList.remove('hidden');
        document.getElementById('btn-submit').classList.add('hidden');
    }

    // Reset giải thích khi sang câu mới
    document.getElementById('explanation-box').classList.add('hidden');
}

function selectOption(optIndex, btnElement) {
    // 1. Lưu đáp án
    userAnswers[currentQuestionIndex] = optIndex;
    
    // 2. Cập nhật giao diện nút bấm
    const siblings = document.getElementById('options-container').children;
    for (let el of siblings) {
        el.classList.remove('selected', 'correct', 'wrong');
        // Khóa các nút khác nếu là chế độ Luyện tập để tránh spam
        if (isPracticeMode) el.style.pointerEvents = 'none'; 
    }
    btnElement.classList.add('selected');

    // 3. Logic Chế độ Luyện tập (Practice Mode)
    if (isPracticeMode) {
        const q = mockQuiz.questions[currentQuestionIndex];
        const isCorrect = (optIndex === q.correctAnswer);
        
        if (isCorrect) {
            btnElement.classList.replace('selected', 'correct');
        } else {
            btnElement.classList.replace('selected', 'wrong');
            // Hiển thị đáp án đúng thực sự
            siblings[q.correctAnswer].classList.add('correct');
        }
        
        // Hiện giải thích
        document.getElementById('explanation-text').innerText = q.explanation;
        document.getElementById('explanation-box').classList.remove('hidden');
    }
}

function nextQuestion() {
    if (currentQuestionIndex < mockQuiz.questions.length - 1) {
        loadQuestion(currentQuestionIndex + 1);
    }
}

function prevQuestion() {
    if (currentQuestionIndex > 0) {
        loadQuestion(currentQuestionIndex - 1);
    }
}

// --- LOGIC THANH NĂNG LƯỢNG & ĐỒNG HỒ ---
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
            processResult();
        }
    }, 1000);
}

// --- LOGIC CHẤM ĐIỂM & NỘP BÀI ---
function submitQuiz() {
    if (confirm("Sĩ tử đã kiểm tra kỹ lưỡng và muốn nộp bài?")) {
        clearInterval(timerInterval);
        processResult();
    }
}

function processResult() {
    let correctCount = 0;
    
    // Chấm điểm
    mockQuiz.questions.forEach((q, index) => {
        if (userAnswers[index] === q.correctAnswer) {
            correctCount++;
        }
    });

    const percent = Math.round((correctCount / mockQuiz.questions.length) * 100);
    const timeUsed = totalTime - (timeLeft > 0 ? timeLeft : 0);
    const m = Math.floor(timeUsed / 60).toString().padStart(2, '0');
    const s = (timeUsed % 60).toString().padStart(2, '0');

    // Chuyển màn hình
    screens.quiz.classList.add('hidden');
    screens.result.classList.remove('hidden');

    // Đổ dữ liệu ra Bảng Vàng
    document.getElementById('result-student-name').innerText = studentName;
    document.getElementById('result-score').innerText = `${correctCount}/${mockQuiz.questions.length}`;
    document.getElementById('result-percent').innerText = `${percent}%`;
    document.getElementById('result-time').innerText = `${m}:${s}`;
}
