const axios = require('axios');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const MODEL = process.env.OLLAMA_MODEL || 'llama3';

const OllamaService = {
    async summarize(text) {
        try {
            const prompt = `Please summarize the following stock market news transcript and highlight key financial data points, ticker symbols mentioned, and market sentiment:\n\n${text}`;
            
            const response = await axios.post(OLLAMA_URL, {
                model: MODEL,
                prompt: prompt,
                stream: false
            });

            return response.data.response;
        } catch (error) {
            console.error('Ollama Error:', error.message);
            return null;
        }
    }
};

module.exports = OllamaService;