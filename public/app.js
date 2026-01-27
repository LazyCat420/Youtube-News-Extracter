document.addEventListener('DOMContentLoaded', () => {
    const urlInput = document.getElementById('youtubeUrl');
    const extractBtn = document.getElementById('extractBtn');
    const loadingDiv = document.getElementById('loading');
    const resultDiv = document.getElementById('result');
    const errorDiv = document.getElementById('error');
    const errorMsg = document.getElementById('errorMsg');

    // Result elements
    const videoTitle = document.getElementById('videoTitle');
    const videoDesc = document.getElementById('videoDesc');
    const transcriptText = document.getElementById('transcriptText');
    const copyBtn = document.getElementById('copyBtn');

    extractBtn.addEventListener('click', async () => {
        const url = urlInput.value.trim();
        if (!url) {
            showError('Please enter a YouTube URL');
            return;
        }

        // Reset UI
        hideAll();
        loadingDiv.classList.remove('hidden');
        extractBtn.disabled = true;

        try {
            const response = await fetch('/api/extract', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                showResult(data);
            } else {
                showError(data.error || 'Failed to extract transcript');
            }

        } catch (error) {
            console.error('Error:', error);
            showError('An error occurred while connecting to the server.');
        } finally {
            loadingDiv.classList.add('hidden');
            extractBtn.disabled = false;
        }
    });

    copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(transcriptText.textContent).then(() => {
            const originalText = copyBtn.textContent;
            copyBtn.textContent = 'Copied!';
            setTimeout(() => {
                copyBtn.textContent = originalText;
            }, 2000);
        });
    });

    function showResult(data) {
        videoTitle.textContent = data.title;
        videoDesc.textContent = data.description || 'No description available';
        transcriptText.textContent = data.transcript;
        resultDiv.classList.remove('hidden');
    }

    function showError(msg) {
        errorMsg.textContent = msg;
        errorDiv.classList.remove('hidden');
    }

    function hideAll() {
        resultDiv.classList.add('hidden');
        errorDiv.classList.add('hidden');
    }
});
