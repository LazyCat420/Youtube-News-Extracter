document.addEventListener('DOMContentLoaded', () => {
    // State
    let currentPreviewData = null;
    let allVideos = [];
    let deleteTargetId = null;

    // Extract Elements (unified pipeline — no tabs)
    const urlInput = document.getElementById('youtubeUrl');
    const extractBtn = document.getElementById('extractBtn');
    const loadingDiv = document.getElementById('loading');
    const previewDiv = document.getElementById('preview');
    const successDiv = document.getElementById('success');
    const errorDiv = document.getElementById('error');
    const errorMsg = document.getElementById('errorMsg');
    const successMsg = document.getElementById('successMsg');

    const previewTitle = document.getElementById('previewTitle');
    const previewDesc = document.getElementById('previewDesc');
    const previewTranscript = document.getElementById('previewTranscript');
    const copyBtn = document.getElementById('copyBtn');
    const saveBtn = document.getElementById('saveBtn');

    const searchInput = document.getElementById('searchInput');
    const videoCount = document.getElementById('videoCount');
    const videoFeed = document.getElementById('videoFeed');
    const reportViewer = document.getElementById('reportViewer');
    const reportList = document.getElementById('reportList');
    const dbLoading = document.getElementById('dbLoading');
    const emptyState = document.getElementById('emptyState');

    // Modal Elements
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modalTitle');
    const modalDate = document.getElementById('modalDate');
    const modalLength = document.getElementById('modalLength');
    const modalTranscript = document.getElementById('modalTranscript');
    const closeModal = document.getElementById('closeModal');
    const modalCopyBtn = document.getElementById('modalCopyBtn');

    // Delete Modal Elements
    const deleteModal = document.getElementById('deleteModal');
    const deleteVideoTitle = document.getElementById('deleteVideoTitle');
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    const closeDeleteModalBtns = document.querySelectorAll('.close-delete-modal');

    // ============ Auto-load everything (no tabs) ============
    loadVideos();
    loadDailyWorkspace();  // populates currentDailyVideos + renders workspace
    loadChannels();

    // ============ Extract Tab ============
    extractBtn.addEventListener('click', async () => {
        const url = urlInput.value.trim();
        if (!url) {
            showError('Please enter a YouTube URL');
            return;
        }

        hideAllExtract();
        loadingDiv.classList.remove('hidden');
        extractBtn.disabled = true;

        try {
            const response = await fetch('/api/extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                currentPreviewData = data;
                showPreview(data);
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

    // Allow Enter key to trigger extract
    urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            extractBtn.click();
        }
    });

    copyBtn.addEventListener('click', () => {
        copyToClipboard(previewTranscript.textContent, copyBtn);
    });

    saveBtn.addEventListener('click', async () => {
        if (!currentPreviewData) return;

        saveBtn.disabled = true;
        saveBtn.textContent = '💾 Saving...';

        try {
            const response = await fetch('/api/videos/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(currentPreviewData)
            });

            const data = await response.json();

            if (response.ok && data.success) {
                previewDiv.classList.add('hidden');
                showSuccess('Video saved to database successfully!');
                currentPreviewData = null;
                urlInput.value = '';
            } else {
                showError(data.error || 'Failed to save video');
            }
        } catch (error) {
            console.error('Error:', error);
            showError('Failed to save video to database.');
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = '💾 Save to Database';
        }
    });

    function showPreview(data) {
        previewTitle.textContent = data.title;
        previewDesc.textContent = data.description || 'No description available';
        previewTranscript.textContent = data.transcript;
        previewDiv.classList.remove('hidden');
    }

    function showError(msg) {
        errorMsg.textContent = msg;
        errorDiv.classList.remove('hidden');
    }

    function showSuccess(msg) {
        successMsg.textContent = msg;
        successDiv.classList.remove('hidden');

        // Auto-hide after 3 seconds
        setTimeout(() => {
            successDiv.classList.add('hidden');
        }, 3000);
    }

    function hideAllExtract() {
        previewDiv.classList.add('hidden');
        errorDiv.classList.add('hidden');
        successDiv.classList.add('hidden');
    }

    // ============ Database Tab ============
    async function loadVideos() {
        console.log('[Render] Loading videos...');
        dbLoading.classList.remove('hidden');
        videoFeed.innerHTML = '';
        emptyState.classList.add('hidden');

        try {
            const response = await fetch('/api/videos');
            const data = await response.json();

            if (response.ok && data.success) {
                allVideos = data.videos;
                renderVideos(allVideos);
            } else {
                videoFeed.innerHTML = '<p class="term-empty">Failed to load videos.</p>';
            }
        } catch (error) {
            console.error('Error:', error);
            videoFeed.innerHTML = '<p class="term-empty">Failed to connect to server.</p>';
        } finally {
            dbLoading.classList.add('hidden');
        }

        // Also load reports
        loadReports();
    }

    function groupByDate(videos) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
        const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);

        const groups = {
            'TODAY': [],
            'YESTERDAY': [],
            'THIS WEEK': [],
            'OLDER': []
        };

        videos.forEach(v => {
            const d = new Date(v.scraped_at);
            if (d >= today) groups['TODAY'].push(v);
            else if (d >= yesterday) groups['YESTERDAY'].push(v);
            else if (d >= weekAgo) groups['THIS WEEK'].push(v);
            else groups['OLDER'].push(v);
        });

        return groups;
    }

    function renderVideos(videos) {
        console.log('[Render] Rendering', videos.length, 'videos');
        videoCount.textContent = `${videos.length} video${videos.length !== 1 ? 's' : ''}`;

        if (videos.length === 0) {
            emptyState.classList.remove('hidden');
            videoFeed.innerHTML = '';
            return;
        }

        emptyState.classList.add('hidden');
        const groups = groupByDate(videos);
        let html = '';

        Object.entries(groups).forEach(([label, items]) => {
            if (items.length === 0) return;

            const summarized = items.filter(v => v.summary && v.summary.length > 0).length;
            const unsummarized = items.length - summarized;
            const isOpen = items.length <= 10 ? 'open' : '';

            html += `
            <details class="date-group" ${isOpen}>
                <summary class="date-group-header">
                    <span class="date-group-label">▸ ${label}</span>
                    <span class="date-group-badges">
                        ${unsummarized > 0 ? `<span class="badge-amber">${unsummarized} pending</span>` : ''}
                        ${summarized > 0 ? `<span class="badge-green">${summarized} ready</span>` : ''}
                        <span class="badge-total">${items.length}</span>
                    </span>
                </summary>
                <div class="date-group-body">
                    ${items.map(video => {
                const hasSummary = video.summary && video.summary.length > 0;
                const statusDot = hasSummary ? '<span class="status-dot dot-green"></span>' : '<span class="status-dot dot-amber"></span>';
                return `
                        <div class="term-card ${hasSummary ? 'card-ready' : 'card-pending'}" data-id="${video.id}">
                            <div class="term-card-row">
                                <img class="term-card-thumb" src="https://i.ytimg.com/vi/${video.video_id}/mqdefault.jpg" alt="" onerror="this.style.display='none'" loading="lazy" />
                                <div class="term-card-info">
                                    <div class="term-card-title-row">
                                        ${statusDot}
                                        <a href="https://youtube.com/watch?v=${video.video_id}" target="_blank" class="term-card-title">${escapeHtml(video.title || 'Untitled Video')}</a>
                                    </div>
                                    <div class="term-card-meta">
                                        <span>${formatDate(video.scraped_at)}</span>
                                        <span>${formatNumber(video.transcript_length)} chars</span>
                                        ${hasSummary ? '<span class="meta-ready">SUMMARIZED</span>' : '<span class="meta-pending">PENDING</span>'}
                                    </div>
                                </div>
                            </div>
                            ${hasSummary ? `<div class="term-card-summary">${escapeHtml(video.summary).replace(/\\n/g, '<br>')}</div>` : ''}
                            <div class="term-card-actions">
                                <button class="term-btn term-btn-sm view-btn" data-id="${video.id}">VIEW</button>
                                ${!hasSummary ? `<button class="term-btn term-btn-green term-btn-sm summarize-single-btn" data-id="${video.id}" data-title="${escapeHtml(video.title || 'Untitled')}">SUMMARIZE</button>` : ''}
                                <button class="term-btn term-btn-red term-btn-sm delete-btn" data-id="${video.id}" data-title="${escapeHtml(video.title || 'Untitled')}">DEL</button>
                            </div>
                        </div>`;
            }).join('')}
                </div>
            </details>`;
        });

        videoFeed.innerHTML = html;

        // Attach event listeners
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => viewVideo(btn.dataset.id));
        });

        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                deleteTargetId = btn.dataset.id;
                deleteVideoTitle.textContent = btn.dataset.title;
                deleteModal.classList.remove('hidden');
            });
        });

        // Single video summarize buttons
        document.querySelectorAll('.summarize-single-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                btn.disabled = true;
                btn.textContent = '...';
                try {
                    const resp = await fetch(`/api/summarize/${id}`, { method: 'POST' });
                    const data = await resp.json();
                    if (data.success) {
                        btn.textContent = 'OK';
                        const v = allVideos.find(v => v.id == id);
                        if (v) v.summary = data.summary;
                        setTimeout(() => loadVideos(), 1500);
                    } else {
                        btn.textContent = 'ERR';
                        alert(data.error || 'Summarization failed');
                        setTimeout(() => { btn.textContent = 'SUMMARIZE'; btn.disabled = false; }, 2000);
                    }
                } catch (err) {
                    console.error('Summarize error:', err);
                    btn.textContent = 'ERR';
                    setTimeout(() => { btn.textContent = 'SUMMARIZE'; btn.disabled = false; }, 2000);
                }
            });
        });
    }

    // ============ Report History ============
    async function loadReports() {
        console.log('[Reports] Loading report history...');
        try {
            const resp = await fetch('/api/reports');
            const data = await resp.json();
            if (data.success && data.reports.length > 0) {
                reportList.innerHTML = data.reports.map(r => {
                    const d = new Date(r.generated_at);
                    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                    const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                    const preview = (r.preview || '').substring(0, 80);
                    return `
                    <div class="report-history-item" data-id="${r.id}">
                        <div class="report-item-header">
                            <span class="report-item-date">${dateStr} ${timeStr}</span>
                            <span class="report-item-count">${r.video_count} sources</span>
                        </div>
                        <div class="report-item-preview">${escapeHtml(preview)}...</div>
                        <div class="report-item-actions">
                            <button class="term-btn term-btn-sm report-view-btn" data-id="${r.id}">VIEW</button>
                            <button class="term-btn term-btn-red term-btn-sm report-delete-btn" data-id="${r.id}">DEL</button>
                        </div>
                    </div>`;
                }).join('');

                // Attach report action listeners
                document.querySelectorAll('.report-view-btn').forEach(btn => {
                    btn.addEventListener('click', () => displayReport(btn.dataset.id));
                });
                document.querySelectorAll('.report-delete-btn').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        try {
                            await fetch(`/api/reports/${btn.dataset.id}`, { method: 'DELETE' });
                            loadReports();
                        } catch (err) {
                            console.error('[Reports] Delete error:', err);
                        }
                    });
                });

                console.log(`[Reports] Loaded ${data.reports.length} reports`);
            } else {
                reportList.innerHTML = '<p class="term-empty">No saved reports yet.</p>';
            }
        } catch (err) {
            console.error('[Reports] Load error:', err);
            reportList.innerHTML = '<p class="term-empty">Error loading reports.</p>';
        }
    }

    async function displayReport(id) {
        console.log('[Reports] Displaying report', id);
        reportViewer.innerHTML = '<div class="report-loading"><div class="spinner"></div><p>Loading report...</p></div>';
        try {
            const resp = await fetch(`/api/reports/${id}`);
            const data = await resp.json();
            if (data.success) {
                const r = data.report;
                const d = new Date(r.generated_at);
                const formattedReport = formatReportText(r.content);
                reportViewer.innerHTML = `
                    <div class="report-display">
                        <div class="report-display-meta">
                            ${d.toLocaleDateString()} ${d.toLocaleTimeString()} · ${r.video_count} sources
                        </div>
                        <div class="report-display-content">${formattedReport}</div>
                    </div>`;
                console.log(`[Reports] Displayed report #${id}`);
            }
        } catch (err) {
            reportViewer.innerHTML = `<p class="term-empty">Error loading report: ${err.message}</p>`;
        }
    }

    function formatReportText(text) {
        return text.split('\n').map(line => {
            const trimmed = line.trim();
            if (!trimmed) return '<br>';
            if (/^[^\w\s\-]/.test(trimmed) && trimmed.length < 80 && !trimmed.startsWith('-')) {
                return `<div class="report-section-header">${escapeHtml(trimmed)}</div>`;
            }
            if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
                return `<div class="report-bullet">${escapeHtml(trimmed)}</div>`;
            }
            return `<p class="report-paragraph">${escapeHtml(trimmed)}</p>`;
        }).join('');
    }

    // Search functionality
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase().trim();
        if (!query) {
            renderVideos(allVideos);
        } else {
            const filtered = allVideos.filter(v =>
                (v.title || '').toLowerCase().includes(query) ||
                (v.transcript_preview || '').toLowerCase().includes(query)
            );
            renderVideos(filtered);
        }
    });

    let currentModalVideoId = null;

    async function viewVideo(id) {
        try {
            const response = await fetch(`/api/videos/${id}`);
            const data = await response.json();

            if (response.ok && data.success) {
                const video = data.video;
                currentModalVideoId = video.id;
                modalTitle.textContent = video.title || 'Untitled Video';
                modalDate.textContent = `📅 ${formatDate(video.scraped_at)}`;
                modalLength.textContent = `📝 ${formatNumber(video.transcript?.length || 0)} characters`;
                modalTranscript.textContent = video.transcript || 'No transcript available';

                // Show summary if exists
                const summarySection = document.getElementById('modalSummarySection');
                const summaryContent = document.getElementById('modalSummary');
                const summarizeBtn = document.getElementById('modalSummarizeBtn');

                if (video.summary) {
                    summaryContent.innerHTML = video.summary.replace(/\n/g, '<br>');
                    summarySection.classList.remove('hidden');
                    summarizeBtn.textContent = '🔄 Re-Summarize';
                } else {
                    summarySection.classList.add('hidden');
                    summaryContent.innerHTML = '';
                    summarizeBtn.textContent = '🤖 Summarize';
                }

                // Populate modal model picker
                const modalModelSelect = document.getElementById('modalModelSelect');
                try {
                    const mResp = await fetch('/api/ollama/models');
                    const mData = await mResp.json();
                    if (mData.success) {
                        const settingsResp = await fetch('/api/settings');
                        const settingsData = await settingsResp.json();
                        const defaultModel = settingsData.settings?.ollama_model || '';
                        modalModelSelect.innerHTML = `<option value="">— ${defaultModel || 'default model'} —</option>`;
                        mData.models.forEach(m => {
                            const opt = document.createElement('option');
                            opt.value = m.name;
                            opt.textContent = m.name;
                            modalModelSelect.appendChild(opt);
                        });
                    }
                } catch (e) { console.error('Model list error:', e); }

                modal.classList.remove('hidden');
            } else {
                alert('Failed to load video details.');
            }
        } catch (error) {
            console.error('Error:', error);
            alert('Failed to connect to server.');
        }
    }

    closeModal.addEventListener('click', () => {
        modal.classList.add('hidden');
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.add('hidden');
        }
    });

    modalCopyBtn.addEventListener('click', () => {
        copyToClipboard(modalTranscript.textContent, modalCopyBtn);
    });

    // ============ Delete Modal ============
    closeDeleteModalBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            deleteModal.classList.add('hidden');
            deleteTargetId = null;
        });
    });

    deleteModal.addEventListener('click', (e) => {
        if (e.target === deleteModal) {
            deleteModal.classList.add('hidden');
            deleteTargetId = null;
        }
    });

    confirmDeleteBtn.addEventListener('click', async () => {
        if (!deleteTargetId) return;

        confirmDeleteBtn.disabled = true;
        confirmDeleteBtn.textContent = 'Deleting...';

        try {
            const response = await fetch(`/api/videos/${deleteTargetId}`, {
                method: 'DELETE'
            });

            const data = await response.json();

            if (response.ok && data.success) {
                deleteModal.classList.add('hidden');
                deleteTargetId = null;
                loadVideos(); // Refresh the list
            } else {
                alert(data.error || 'Failed to delete video.');
            }
        } catch (error) {
            console.error('Error:', error);
            alert('Failed to connect to server.');
        } finally {
            confirmDeleteBtn.disabled = false;
            confirmDeleteBtn.textContent = '🗑️ Delete';
        }
    });

    // ============ Utility Functions ============
    function copyToClipboard(text, button) {
        navigator.clipboard.writeText(text).then(() => {
            const originalText = button.textContent;
            button.textContent = '✅ Copied!';
            setTimeout(() => {
                button.textContent = originalText;
            }, 2000);
        });
    }

    function formatDate(dateStr) {
        if (!dateStr) return 'Unknown date';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function formatNumber(num) {
        if (!num) return '0';
        return num.toLocaleString();
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ============ Playlist Tab ============
    const playlistLoading = document.getElementById('playlistLoading');
    const playlistHistory = document.getElementById('playlistHistory');
    const generatePlaylistBtn = document.getElementById('generatePlaylistBtn');
    const channelsList = document.getElementById('channelsList');
    const authStatus = document.getElementById('authStatus');
    const authActions = document.getElementById('authActions');

    // V2 Workspace elements
    const syncFeedback = document.getElementById('syncFeedback');
    const pendingVideos = document.getElementById('pendingVideos');
    const extractedVideos = document.getElementById('extractedVideos');
    const ignoredVideos = document.getElementById('ignoredVideos');
    const pendingCount = document.getElementById('pendingCount');
    const extractedCount = document.getElementById('extractedCount');
    const ignoredCount = document.getElementById('ignoredCount');
    // V3 elements
    const discoverBtn = document.getElementById('discoverBtn');

    // Store state
    let channelsData = [];
    let isLoggedIn = false;
    let authConfigured = false;
    let currentDailyFile = null; // The filename of today's daily file
    let currentDailyVideos = []; // All videos from today's file

    const categoryEmojis = {
        finance: '🏦',
        sports: '🏈',
        cooking: '🍳',
        tech: '💻',
        news: '📰',
        other: '📦'
    };

    // Check YouTube auth status on page load
    async function checkAuthStatus() {
        try {
            const response = await fetch('/api/auth/status');
            const data = await response.json();

            authConfigured = data.configured;
            isLoggedIn = data.loggedIn;

            if (!data.configured) {
                authStatus.innerHTML = '<span class="auth-not-configured">⚠️ YouTube API not configured</span>';
                authActions.innerHTML = '<a href="/.env.example" target="_blank" class="secondary-btn">Setup Guide</a>';
            } else if (data.loggedIn && data.user) {
                authStatus.innerHTML = `
                    ${data.user.picture ? `<img src="${data.user.picture}" alt="Profile">` : ''}
                    <span class="user-name">Logged in as ${data.user.name || data.user.email}</span>
                `;
                authActions.innerHTML = '<a href="/auth/logout" class="logout-btn">Logout</a>';
            } else {
                authStatus.innerHTML = '<span>Login to save playlists to YouTube</span>';
                authActions.innerHTML = '<a href="/auth/google" class="google-login-btn">🔐 Login with Google</a>';
            }
        } catch (error) {
            console.error('Auth status check failed:', error);
            authStatus.innerHTML = '<span class="auth-not-configured">Auth check failed</span>';
        }
    }

    // ============ Workspace: Load Today's Daily File ============
    async function loadDailyWorkspace() {
        try {
            const response = await fetch('/api/playlist/history');
            const data = await response.json();
            if (!data.success || !data.playlists || data.playlists.length === 0) {
                renderWorkspaceEmpty();
                renderPlaylists([]);
                return;
            }

            // The first playlist is the most recent (today's)
            const todayPlaylist = data.playlists[0];
            currentDailyFile = todayPlaylist.filename;
            currentDailyVideos = Array.isArray(todayPlaylist.data) ? todayPlaylist.data : [];

            renderWorkspace(currentDailyVideos);
            renderPlaylists(data.playlists);
        } catch (error) {
            console.error('Error loading workspace:', error);
            renderWorkspaceEmpty();
        }
    }

    function renderWorkspaceEmpty() {
        pendingVideos.innerHTML = '<p class="group-empty">No videos yet. Click "Sync Daily Feed" to start!</p>';
        extractedVideos.innerHTML = '';
        ignoredVideos.innerHTML = '';
        pendingCount.textContent = '0';
        extractedCount.textContent = '0';
        ignoredCount.textContent = '0';
    }

    // ============ Workspace: Render Grouped Videos ============
    function renderWorkspace(videos) {
        // Merge pending + approved into one "ready" group
        const groups = {
            ready: videos.filter(v => (v.status || 'pending') === 'pending' || v.status === 'approved'),
            extracted: videos.filter(v => v.status === 'extracted'),
            ignored: videos.filter(v => v.status === 'ignored')
        };

        // Update counts
        pendingCount.textContent = groups.ready.length;
        extractedCount.textContent = groups.extracted.length;
        ignoredCount.textContent = groups.ignored.length;

        // Cluster ready videos by topic
        if (groups.ready.length > 0 && window.TopicDedup) {
            const allowList = (currentFilters && currentFilters.allow_list) || [];
            const { clusters } = window.TopicDedup.clusterByTopic(groups.ready, allowList);

            // Render: multi-video clusters get cluster cards, solo gets normal cards
            pendingVideos.innerHTML = clusters.map(cluster => {
                if (cluster.videos.length > 1) {
                    return renderClusterCard(cluster);
                } else {
                    return renderVideoCard(cluster.videos[0], 'pending');
                }
            }).join('');
        } else if (groups.ready.length > 0) {
            // Fallback if TopicDedup not loaded
            pendingVideos.innerHTML = groups.ready.map(v => renderVideoCard(v, 'pending')).join('');
        } else {
            pendingVideos.innerHTML = '<p class="group-empty">All caught up! No videos to review.</p>';
        }

        extractedVideos.innerHTML = groups.extracted.length > 0
            ? groups.extracted.map(v => renderVideoCard(v, 'extracted')).join('')
            : '';

        ignoredVideos.innerHTML = groups.ignored.length > 0
            ? groups.ignored.map(v => renderVideoCard(v, 'ignored')).join('')
            : '';

        // Show/hide empty groups
        document.getElementById('extractedGroup').style.display = groups.extracted.length > 0 ? 'block' : 'none';
        document.getElementById('ignoredGroup').style.display = groups.ignored.length > 0 ? 'block' : 'none';

        // Attach workspace event listeners
        attachWorkspaceListeners();
    }
    /**
     * Render a cluster card for multi-video topic groups.
     * Shows a collapsed summary with source count, expandable to pick the best video.
     */
    function renderClusterCard(cluster) {
        const videos = cluster.videos;
        const channels = [...new Set(videos.map(v => v.channelName || 'Unknown'))];
        const channelList = channels.slice(0, 3).join(', ') + (channels.length > 3 ? ` +${channels.length - 3}` : '');
        const anchorTitle = escapeHtml(videos[0].title || 'Untitled');
        const videoIds = videos.map(v => v.id).join(',');
        const thumb = videos[0].thumbnail || `https://i.ytimg.com/vi/${videos[0].id}/mqdefault.jpg`;

        // Build the expanded picker rows
        const pickerRows = videos.map((v, i) => {
            const vTitle = escapeHtml(v.title || 'Untitled');
            const vChannel = escapeHtml(v.channelName || 'Unknown');
            const vThumb = v.thumbnail || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`;
            return `
                <label class="cluster-pick-row" data-id="${v.id}">
                    <input type="radio" name="cluster-${videos[0].id}" value="${v.id}" ${i === 0 ? 'checked' : ''} />
                    <img src="${vThumb}" alt="" class="cluster-pick-thumb" />
                    <div class="cluster-pick-info">
                        <span class="cluster-pick-title">${vTitle}</span>
                        <span class="cluster-pick-channel">${vChannel}</span>
                    </div>
                </label>
            `;
        }).join('');

        return `
            <div class="cluster-card" data-cluster-ids="${videoIds}">
                <div class="cluster-header">
                    <img src="${thumb}" alt="" class="cluster-thumb" />
                    <div class="cluster-info">
                        <span class="cluster-title">${anchorTitle}</span>
                        <span class="cluster-sources">📺 ${channelList} · <strong>${videos.length} sources</strong></span>
                    </div>
                    <div class="cluster-actions">
                        <button class="ws-btn cluster-toggle" title="Pick best video">▼ Pick Best</button>
                        <button class="ws-btn ws-dismiss-trigger cluster-dismiss-all" data-ids="${videoIds}" title="Dismiss all ${videos.length} videos">🚫 All</button>
                    </div>
                </div>
                <div class="cluster-picker hidden">
                    ${pickerRows}
                    <div class="cluster-picker-actions">
                        <button class="small-btn cluster-keep-selected" data-ids="${videoIds}">✅ Keep Selected · Dismiss Rest</button>
                    </div>
                </div>
            </div>
        `;
    }

    function renderVideoCard(video, groupType) {
        const title = escapeHtml(video.title || 'Untitled');
        const channel = escapeHtml(video.channelName || 'Unknown');
        const category = video.category || 'other';
        const emoji = categoryEmojis[category] || '📺';
        const thumb = video.thumbnail || `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`;
        const filterInfo = video.filter_reason && video.filter_reason !== 'neutral'
            ? `<span class="filter-badge" title="${escapeHtml(video.filter_reason)}">🔍 ${video.filter_score > 0 ? '+' : ''}${(video.filter_score || 0).toFixed(1)}</span>`
            : '';
        // V3: Discovery badge
        const discoveryBadge = video.source === 'discovery'
            ? '<span class="discovery-badge" title="Found via Discovery Engine">✨ Suggested</span>'
            : '';
        // V3: Context tier indicator
        const tierBadge = video.context_tier === 'A'
            ? '<span class="tier-badge tier-a" title="Deep Dive (>5 min)">📚</span>'
            : video.context_tier === 'C'
                ? '<span class="tier-badge tier-c" title="Short (<1 min)">⚡</span>'
                : '';

        // Different action buttons based on group
        let actions = '';
        if (groupType === 'pending') {
            actions = `
                <button class="ws-btn ws-dismiss-trigger" data-id="${video.id}" data-title="${title}" title="Dismiss this video">🚫</button>
            `;
        } else if (groupType === 'extracted') {
            actions = `<span class="status-badge status-extracted">✅ Done</span>`;
        } else if (groupType === 'ignored') {
            const blockedBadge = video.blocked_term
                ? `<span class="blocked-badge" title="Blocked by phrase: ${escapeHtml(video.blocked_term)}">
                     🚫 "${escapeHtml(video.blocked_term)}"
                   </span>
                   <button class="ws-btn ws-edit-block" data-id="${video.id}" data-term="${escapeHtml(video.blocked_term)}" title="Edit block phrase">✏️</button>`
                : '';
            actions = `
                ${blockedBadge}
                <button class="ws-btn ws-restore" data-id="${video.id}" data-status="pending" title="Restore to pending">↩️</button>
            `;
        }

        return `
            <div class="ws-video-card ${groupType}" data-video-id="${video.id}">
                <img class="ws-thumb" src="${thumb}" alt="" onerror="this.style.display='none'" loading="lazy">
                <div class="ws-video-info">
                    <a href="https://youtube.com/watch?v=${video.id}" target="_blank" class="ws-title" title="${title}">${title}</a>
                    <div class="ws-meta">
                        <span class="ws-channel">${channel}</span>
                        <span class="ws-category">${emoji} ${category}</span>
                        ${tierBadge}
                        ${filterInfo}
                        ${discoveryBadge}
                    </div>
                </div>
                <div class="ws-actions">${actions}</div>
            </div>
        `;
    }



    // ============ Workspace: Event Listeners ============
    function attachWorkspaceListeners() {
        // Status change buttons — approve, revert, restore (NOT ignore/dismiss)
        document.querySelectorAll('.ws-btn[data-status]').forEach(btn => {
            // Skip dismiss triggers — they have their own handler
            if (btn.classList.contains('ws-dismiss-trigger')) return;
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const videoId = btn.dataset.id;
                const newStatus = btn.dataset.status;
                await updateVideoStatus(videoId, newStatus);
            });
        });

        // Smart Dismiss popup triggers
        document.querySelectorAll('.ws-dismiss-trigger').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const videoId = btn.dataset.id;
                const title = btn.dataset.title || '';
                showDismissPopup(btn, videoId, title);
            });
        });

        // Extract single video
        document.querySelectorAll('.ws-extract-single').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const videoId = btn.dataset.id;
                btn.disabled = true;
                btn.textContent = '⏳';

                try {
                    const video = currentDailyVideos.find(v => v.id === videoId);
                    if (!video) throw new Error('Video not found');

                    const response = await fetch('/api/extract', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${videoId}` })
                    });
                    const data = await response.json();

                    if (data.success && data.transcript) {
                        // Save to database
                        await fetch('/api/videos/save', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(data)
                        });

                        // Update status to extracted
                        await updateVideoStatus(videoId, 'extracted');
                        showSuccess(`Extracted: ${video.title}`);
                    } else {
                        throw new Error(data.error || 'Extraction failed');
                    }
                } catch (error) {
                    console.error('Extract error:', error);
                    btn.textContent = '❌';
                    showError(error.message);
                    setTimeout(() => { btn.textContent = '📝'; btn.disabled = false; }, 2000);
                }
            });
        });

        // Block button (add to block list from ignored videos)
        document.querySelectorAll('.ws-block').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const title = btn.dataset.title;
                // Let user pick a keyword from the title to block
                const keyword = prompt(`Block a keyword from: "${title}"\n\nEnter the word or phrase to add to the block list:`);
                if (keyword && keyword.trim()) {
                    addFilterTerm(keyword.trim(), 'block_list');
                }
            });
        });

        // Edit block phrase on ignored videos
        document.querySelectorAll('.ws-edit-block').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const videoId = btn.dataset.id;
                const oldTerm = btn.dataset.term;
                const newTerm = prompt(`Edit block phrase:\n\nCurrent: "${oldTerm}"\nEnter new phrase (or clear to remove block):`, oldTerm);

                if (newTerm === null) return; // Cancelled

                const trimmed = newTerm.trim();

                // Remove old term from filters
                if (oldTerm) {
                    try {
                        await fetch('/api/playlist/filters/remove-term', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ term: oldTerm, list: 'block_list' })
                        });
                    } catch (err) {
                        console.error('Failed to remove old filter term:', err);
                    }
                }

                if (trimmed) {
                    // Add new term to filters
                    await addFilterTerm(trimmed, 'block_list');
                    // Update video's blocked_term
                    await updateVideoStatus(videoId, 'ignored', trimmed);
                    showSuccess(`🚫 Block phrase updated to "${trimmed}"`);
                } else {
                    // Clear blocked_term (phrase removed, but video stays ignored)
                    await updateVideoStatus(videoId, 'ignored', '');
                    showSuccess('Block phrase removed. Video remains ignored.');
                }
            });
        });

        // ============ Cluster Event Handlers ============

        // Toggle cluster picker open/closed
        document.querySelectorAll('.cluster-toggle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const card = btn.closest('.cluster-card');
                const picker = card.querySelector('.cluster-picker');
                const isHidden = picker.classList.contains('hidden');
                picker.classList.toggle('hidden');
                btn.textContent = isHidden ? '▲ Close' : '▼ Pick Best';
            });
        });

        // Dismiss all videos in a cluster
        document.querySelectorAll('.cluster-dismiss-all').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                e.preventDefault();
                const ids = btn.dataset.ids.split(',');
                btn.disabled = true;
                btn.textContent = '⏳';
                for (const id of ids) {
                    await updateVideoStatus(id, 'ignored');
                }
            });
        });

        // Keep selected video, dismiss rest in cluster
        document.querySelectorAll('.cluster-keep-selected').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const ids = btn.dataset.ids.split(',');
                const card = btn.closest('.cluster-card');
                const selected = card.querySelector('input[type="radio"]:checked');
                if (!selected) return;

                const keepId = selected.value;
                btn.disabled = true;
                btn.textContent = '⏳ Processing...';

                // Dismiss all except the selected one
                for (const id of ids) {
                    if (id !== keepId) {
                        await updateVideoStatus(id, 'ignored');
                    }
                }
            });
        });
    }

    // ============ Smart Dismiss Popup ============
    const DISMISS_STOP_WORDS = new Set([
        'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
        'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall',
        'can', 'need', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
        'through', 'during', 'before', 'after', 'above', 'below', 'between', 'out', 'off',
        'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where',
        'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some',
        'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
        'because', 'but', 'and', 'or', 'if', 'while', 'about', 'against', 'up', 'down', 'this',
        'that', 'these', 'those', 'what', 'which', 'who', 'whom', 'its', 'his', 'her', 'their',
        'our', 'my', 'your', 'it', 'he', 'she', 'they', 'we', 'you', 'i', 'me', 'him', 'us', 'them',
        'video', 'watch', 'live', 'stream', 'new', 'latest', 'today', 'now', 'full', 'official',
        'episode', 'part', 'clip', 'interview', 'show', 'breaking', 'update', 'recap',
        'highlights', 'analysis', 'explained', 'reaction', 'review', 'morning', 'evening',
        'night', 'daily', 'weekly',
    ]);

    function extractSmartKeywords(title) {
        const cleaned = title
            .replace(/[|—–\-:,.'!?#()\[\]{}"/@&]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const words = cleaned.split(' ');
        const originalWords = title.split(/\s+/);

        const keywords = words
            .map(w => w.toLowerCase())
            .filter(w => w.length >= 3 && !DISMISS_STOP_WORDS.has(w) && !/^\d+$/.test(w))
            .map(kw => {
                let score = kw.length;
                // Proper noun bonus
                const orig = originalWords.find(w => w.toLowerCase() === kw);
                if (orig && orig[0] === orig[0].toUpperCase() && orig[0] !== orig[0].toLowerCase()) {
                    score += 5;
                }
                return { word: kw, score };
            });

        // Deduplicate and sort
        const seen = new Set();
        return keywords
            .filter(k => { if (seen.has(k.word)) return false; seen.add(k.word); return true; })
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
            .map(k => k.word);
    }

    let activeDismissPopup = null;

    function closeDismissPopup() {
        if (activeDismissPopup) {
            activeDismissPopup.remove();
            activeDismissPopup = null;
        }
    }

    function showDismissPopup(triggerBtn, videoId, title) {
        // Close any existing popup
        closeDismissPopup();

        const keywords = extractSmartKeywords(title);
        const suggestedKeyword = keywords[0] || '';

        // Build suggestion chips
        const chips = keywords.slice(0, 4).map(kw =>
            `<button class="dismiss-chip" data-word="${kw}">${kw}</button>`
        ).join('');

        const popup = document.createElement('div');
        popup.className = 'dismiss-popup';
        popup.innerHTML = `
            <div class="dismiss-popup-header">Dismiss: "${title.substring(0, 50)}${title.length > 50 ? '...' : ''}"</div>
            <div class="dismiss-popup-actions">
                <button class="dismiss-opt dismiss-just-ignore" data-id="${videoId}">
                    👋 Just Ignore
                    <span class="dismiss-opt-sub">Remove from list, no blocking</span>
                </button>
                <div class="dismiss-block-section">
                    <div class="dismiss-block-label">🚫 Block a topic word:</div>
                    <div class="dismiss-chips">${chips}</div>
                    <div class="dismiss-custom-row">
                        <input type="text" class="dismiss-custom-input" value="${suggestedKeyword}" placeholder="Type a word to block...">
                        <button class="dismiss-opt dismiss-block-confirm" data-id="${videoId}">Block & Ignore</button>
                    </div>
                </div>
            </div>
        `;

        // Position near the trigger button
        const card = triggerBtn.closest('.ws-video-card') || triggerBtn.closest('.shorts-card');
        if (card) {
            card.style.position = 'relative';
            card.appendChild(popup);
        } else {
            document.body.appendChild(popup);
        }

        activeDismissPopup = popup;

        // Chip click → fill input
        popup.querySelectorAll('.dismiss-chip').forEach(chip => {
            chip.addEventListener('click', (e) => {
                e.stopPropagation();
                popup.querySelector('.dismiss-custom-input').value = chip.dataset.word;
                // Highlight active chip
                popup.querySelectorAll('.dismiss-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
            });
        });

        // "Just Ignore" → status change only
        popup.querySelector('.dismiss-just-ignore').addEventListener('click', async (e) => {
            e.stopPropagation();
            closeDismissPopup();
            await updateVideoStatus(videoId, 'ignored');
        });

        // "Block & Ignore" → add to block_list + ignore, persist the block phrase
        popup.querySelector('.dismiss-block-confirm').addEventListener('click', async (e) => {
            e.stopPropagation();
            const input = popup.querySelector('.dismiss-custom-input');
            const word = input.value.trim();

            if (!word) {
                input.style.borderColor = '#ef4444';
                input.focus();
                return;
            }

            closeDismissPopup();

            // Add to block list
            const success = await addFilterTerm(word, 'block_list');
            if (success) {
                showSuccess(`🚫 Blocked "${word}" — future syncs will filter this topic`);
            }

            // Also ignore the video AND persist the block phrase on the video object
            await updateVideoStatus(videoId, 'ignored', word);
        });

        // Enter key on input → trigger block
        popup.querySelector('.dismiss-custom-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                popup.querySelector('.dismiss-block-confirm').click();
            }
        });

        // Click outside → close
        setTimeout(() => {
            document.addEventListener('click', function outsideClick(e) {
                if (activeDismissPopup && !activeDismissPopup.contains(e.target)) {
                    closeDismissPopup();
                    document.removeEventListener('click', outsideClick);
                }
            });
        }, 100);
    }

    // ============ Add Filter Term (block/allow) ============
    async function addFilterTerm(term, listType) {
        try {
            const response = await fetch('/api/playlist/filters/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ term, listType })
            });
            const data = await response.json();
            if (data.success) {
                console.log(`Filter added: "${data.term}" to ${data.listType}`);
                return true;
            } else {
                showError(data.error || 'Failed to add filter term');
                return false;
            }
        } catch (error) {
            console.error('Add filter error:', error);
            showError('Failed to add filter term');
            return false;
        }
    }
    async function updateVideoStatus(videoId, newStatus, blockedTerm = null) {
        if (!currentDailyFile) return;

        try {
            const body = { status: newStatus };
            if (blockedTerm !== null) body.blocked_term = blockedTerm;

            const response = await fetch(`/api/playlist/${currentDailyFile}/video/${videoId}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await response.json();

            if (data.success) {
                // Update local state
                const video = currentDailyVideos.find(v => v.id === videoId);
                if (video) {
                    video.status = newStatus;
                    if (blockedTerm !== null && blockedTerm !== '') {
                        video.blocked_term = blockedTerm;
                    } else if (newStatus === 'pending' || blockedTerm === '') {
                        delete video.blocked_term;
                    }
                }
                renderWorkspace(currentDailyVideos);
            } else {
                showError(data.error || 'Failed to update status');
            }
        } catch (error) {
            console.error('Status update error:', error);
            showError('Failed to update video status');
        }
    }

    // Bulk status updates
    async function bulkUpdateStatus(videoIds, newStatus) {
        if (!currentDailyFile || videoIds.length === 0) return;

        const label = newStatus === 'approved' ? 'Approving' : 'Dismissing';
        const total = videoIds.length;
        let done = 0;
        let failed = 0;

        for (const videoId of videoIds) {
            try {
                const response = await fetch(`/api/playlist/${currentDailyFile}/video/${videoId}/status`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: newStatus })
                });
                const data = await response.json();

                if (data.success) {
                    const video = currentDailyVideos.find(v => v.id === videoId);
                    if (video) video.status = newStatus;
                    done++;
                } else {
                    failed++;
                }
            } catch (error) {
                console.error(`Bulk update error for ${videoId}:`, error);
                failed++;
            }
        }

        // Re-render once after all updates
        renderWorkspace(currentDailyVideos);

        if (failed === 0) {
            showSuccess(`${label}: ${done}/${total} videos updated`);
        } else {
            showError(`${label}: ${done} succeeded, ${failed} failed`);
        }
    }

    document.querySelector('.approve-all-btn')?.addEventListener('click', async () => {
        const pendingIds = currentDailyVideos
            .filter(v => (v.status || 'pending') === 'pending')
            .map(v => v.id);

        if (pendingIds.length === 0) return;

        const btn = document.querySelector('.approve-all-btn');
        const origText = btn.textContent;
        btn.disabled = true;
        btn.textContent = `⏳ Approving ${pendingIds.length}...`;

        await bulkUpdateStatus(pendingIds, 'approved');

        btn.disabled = false;
        btn.textContent = origText;
    });

    document.querySelector('.dismiss-all-btn')?.addEventListener('click', async () => {
        const pendingIds = currentDailyVideos
            .filter(v => (v.status || 'pending') === 'pending')
            .map(v => v.id);

        if (pendingIds.length === 0) return;

        const btn = document.querySelector('.dismiss-all-btn');
        const origText = btn.textContent;
        btn.disabled = true;
        btn.textContent = `⏳ Dismissing ${pendingIds.length}...`;

        await bulkUpdateStatus(pendingIds, 'ignored');

        btn.disabled = false;
        btn.textContent = origText;
    });

    document.querySelector('.restore-all-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation(); // Don't trigger the collapsed-header toggle
        const ignoredIds = currentDailyVideos
            .filter(v => v.status === 'ignored')
            .map(v => v.id);

        if (ignoredIds.length === 0) return;

        const btn = document.querySelector('.restore-all-btn');
        const origText = btn.textContent;
        btn.disabled = true;
        btn.textContent = `⏳ Restoring ${ignoredIds.length}...`;

        await bulkUpdateStatus(ignoredIds, 'pending');

        btn.disabled = false;
        btn.textContent = origText;
    });

    document.querySelector('.extract-all-btn')?.addEventListener('click', async () => {
        const btn = document.querySelector('.extract-all-btn');
        if (btn.disabled) return; // prevent double-click

        console.log('[Extract All] Clicked. currentDailyVideos:', currentDailyVideos.length);
        // Include both pending + approved (the merged "Ready to Extract" group), exclude shorts
        const readyVideos = currentDailyVideos
            .filter(v => ((v.status || 'pending') === 'pending' || v.status === 'approved') && v.is_short !== true);

        console.log('[Extract All] Ready videos:', readyVideos.length);
        if (readyVideos.length === 0) {
            alert('No videos ready to extract. Click "Sync Daily Feed" first to load videos.');
            return;
        }

        // Start immediately — progress bar provides visual feedback
        console.log('[Extract All] Starting extraction of', readyVideos.length, 'videos...');
        btn.disabled = true;
        btn.textContent = `⏳ 0/${readyVideos.length}`;

        // Show progress banner
        const progressEl = document.getElementById('extractionProgress');
        const statusEl = document.getElementById('extractProgressStatus');
        const countsEl = document.getElementById('extractProgressCounts');
        const titleEl = document.getElementById('extractProgressTitle');
        const barEl = document.getElementById('extractProgressBar');
        const successEl = document.getElementById('extractStatSuccess');
        const failEl = document.getElementById('extractStatFail');
        const skipEl = document.getElementById('extractStatSkip');
        const logEl = document.getElementById('extractResultsLog');

        progressEl.classList.remove('hidden');
        logEl.innerHTML = '';
        let successCount = 0;
        let failCount = 0;
        let skipCount = 0;
        const total = readyVideos.length;

        for (let i = 0; i < readyVideos.length; i++) {
            const video = readyVideos[i];
            const videoTitle = video.title || 'Untitled';
            const pct = Math.round(((i) / total) * 100);

            // Update progress UI
            statusEl.textContent = `⏳ Extracting ${i + 1} of ${total}...`;
            countsEl.textContent = `${i + 1} / ${total}`;
            titleEl.textContent = `📺 ${videoTitle}`;
            barEl.style.width = `${pct}%`;
            btn.textContent = `⏳ ${i + 1}/${total}`;

            try {
                const response = await fetch('/api/extract', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${video.id}` })
                });
                const data = await response.json();

                if (data.success && data.transcript && data.transcript.length > 0) {
                    await fetch('/api/videos/save', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });
                    await updateVideoStatus(video.id, 'extracted');
                    successCount++;
                    logEl.innerHTML += `<div class="log-entry log-success">✅ ${escapeHtml(videoTitle)}</div>`;
                } else {
                    // Got response but no transcript (video has no captions)
                    skipCount++;
                    console.warn(`Skip (no transcript): ${videoTitle}`);
                    logEl.innerHTML += `<div class="log-entry log-skip">⏭️ ${escapeHtml(videoTitle)} — no transcript</div>`;
                }
            } catch (err) {
                failCount++;
                console.error(`Extract failed for ${video.id}:`, err);
                logEl.innerHTML += `<div class="log-entry log-fail">❌ ${escapeHtml(videoTitle)} — error</div>`;
            }
            // Auto-scroll log to bottom
            logEl.scrollTop = logEl.scrollHeight;

            // Update stats
            successEl.textContent = `✅ ${successCount}`;
            failEl.textContent = `❌ ${failCount}`;
            skipEl.textContent = `⏭️ ${skipCount} skipped`;
        }

        // Completion
        const finalPct = 100;
        barEl.style.width = `${finalPct}%`;
        statusEl.textContent = `✅ Extraction complete!`;
        countsEl.textContent = `${total} / ${total}`;
        titleEl.textContent = `${successCount} extracted, ${skipCount} skipped, ${failCount} failed`;

        btn.textContent = `✅ ${successCount}/${total}`;
        showSuccess(`Extracted ${successCount} of ${total} transcripts!`);
        setTimeout(() => { btn.textContent = '📝 Extract All'; btn.disabled = false; }, 5000);

        // Auto-hide progress after 10s
        setTimeout(() => { progressEl.classList.add('hidden'); }, 10000);

        // Refresh database list (Step 3) and smooth-scroll to it
        loadVideos();
        setTimeout(() => {
            document.getElementById('step3')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 1500);
    });

    async function bulkUpdateStatus(videoIds, status) {
        if (!currentDailyFile) return;

        try {
            const response = await fetch(`/api/playlist/${currentDailyFile}/bulk-status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videoIds, status })
            });
            const data = await response.json();

            if (data.success) {
                videoIds.forEach(id => {
                    const video = currentDailyVideos.find(v => v.id === id);
                    if (video) video.status = status;
                });
                renderWorkspace(currentDailyVideos);
                showSuccess(`Updated ${data.updated} videos to "${status}"`);
            }
        } catch (error) {
            console.error('Bulk update error:', error);
            showError('Failed to bulk update');
        }
    }

    // ============ Collapsible Sections ============
    document.querySelectorAll('[data-toggle]').forEach(header => {
        header.addEventListener('click', () => {
            const targetId = header.dataset.toggle;
            const target = document.getElementById(targetId);
            if (!target) return;

            target.classList.toggle('hidden');
            const arrow = header.querySelector('.toggle-arrow');
            if (arrow) arrow.textContent = target.classList.contains('hidden') ? '▶' : '▼';
        });
    });

    // ============ Filter Management ============
    let currentFilters = { block_list: [], allow_list: [], category_rules: {} };

    async function loadFilters() {
        try {
            const response = await fetch('/api/playlist/filters');
            const data = await response.json();
            if (data.success) {
                currentFilters = data.filters;
                renderFilters();
            }
        } catch (error) {
            console.error('Load filters error:', error);
        }
    }

    function renderFilters() {
        const blockItems = document.getElementById('blockListItems');
        const allowItems = document.getElementById('allowListItems');
        const blockCount = document.getElementById('blockCount');
        const allowCount = document.getElementById('allowCount');

        blockCount.textContent = currentFilters.block_list.length;
        allowCount.textContent = currentFilters.allow_list.length;

        blockItems.innerHTML = currentFilters.block_list.map(term =>
            `<div class="filter-item">
                <span>${escapeHtml(term)}</span>
                <button class="filter-remove-btn" data-term="${escapeHtml(term)}" data-list="block_list">✕</button>
            </div>`
        ).join('') || '<p class="filter-empty">No blocked terms</p>';

        allowItems.innerHTML = currentFilters.allow_list.map(term =>
            `<div class="filter-item">
                <span>${escapeHtml(term)}</span>
                <button class="filter-remove-btn" data-term="${escapeHtml(term)}" data-list="allow_list">✕</button>
            </div>`
        ).join('') || '<p class="filter-empty">No allowed terms</p>';

        // Attach remove listeners
        document.querySelectorAll('.filter-remove-btn').forEach(btn => {
            btn.addEventListener('click', () => removeFilterTerm(btn.dataset.term, btn.dataset.list));
        });
    }

    async function addFilterTerm(term, list) {
        try {
            const response = await fetch('/api/playlist/filters/add-term', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ term, list })
            });
            const data = await response.json();
            if (data.success) {
                currentFilters = data.filters;
                renderFilters();
                showSuccess(`Added "${term}" to ${list.replace('_', ' ')}`);
            }
        } catch (error) {
            console.error('Add term error:', error);
            showError('Failed to add filter term');
        }
    }

    async function removeFilterTerm(term, list) {
        try {
            const response = await fetch('/api/playlist/filters/remove-term', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ term, list })
            });
            const data = await response.json();
            if (data.success) {
                currentFilters = data.filters;
                renderFilters();
                showSuccess(`Removed "${term}" from ${list.replace('_', ' ')}`);
            }
        } catch (error) {
            console.error('Remove term error:', error);
            showError('Failed to remove filter term');
        }
    }

    // Filter add buttons
    document.getElementById('addBlockTermBtn')?.addEventListener('click', () => {
        const input = document.getElementById('newBlockTerm');
        if (input.value.trim()) {
            addFilterTerm(input.value.trim(), 'block_list');
            input.value = '';
        }
    });

    document.getElementById('addAllowTermBtn')?.addEventListener('click', () => {
        const input = document.getElementById('newAllowTerm');
        if (input.value.trim()) {
            addFilterTerm(input.value.trim(), 'allow_list');
            input.value = '';
        }
    });

    // Allow Enter key to add terms
    document.getElementById('newBlockTerm')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') document.getElementById('addBlockTermBtn').click();
    });
    document.getElementById('newAllowTerm')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') document.getElementById('addAllowTermBtn').click();
    });

    // ============ Playlist History (kept from V1 for older files) ============
    async function loadPlaylists() {
        try {
            const response = await fetch('/api/playlist/history');
            const data = await response.json();
            if (data.success) {
                renderPlaylists(data.playlists);
            }
        } catch (error) {
            console.error('Error loading playlists:', error);
        }
    }

    async function loadChannels() {
        try {
            const response = await fetch('/api/playlist/channels');
            const data = await response.json();
            if (data.success) {
                channelsData = data.channels || [];
                renderChannels();
            }
        } catch (error) {
            console.error('Error loading channels:', error);
            channelsList.innerHTML = '<p class="channels-empty">Error loading channels.</p>';
        }
    }

    function renderChannels() {
        if (channelsData.length === 0) {
            channelsList.innerHTML = '<p class="channels-empty">No channels configured. Add one above!</p>';
            return;
        }

        channelsList.innerHTML = channelsData.map((ch, index) => `
            <div class="channel-item" data-index="${index}">
                <div class="channel-info">
                    <div class="channel-name">${escapeHtml(ch.name)}</div>
                    <div class="channel-url">${escapeHtml(ch.url)}</div>
                    <div class="channel-tags">
                        ${ch.include_shorts ? '<span class="channel-tag">Shorts</span>' : ''}
                        ${ch.channel_id ? '<span class="channel-tag cached">⚡ Cached</span>' : '<span class="channel-tag">New</span>'}
                    </div>
                </div>
                <div class="channel-actions">
                    <button class="delete-btn delete-channel-btn" data-index="${index}" title="Delete channel">🗑️</button>
                </div>
            </div>
        `).join('');

        // Attach delete listeners
        document.querySelectorAll('.delete-channel-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const index = parseInt(btn.dataset.index);
                const channelName = channelsData[index].name;

                if (!confirm(`Delete channel "${channelName}"?`)) return;

                channelsData.splice(index, 1);
                await saveChannels();
                renderChannels();
                showSuccess(`Deleted: ${channelName}`);
            });
        });
    }

    function renderPlaylists(playlists) {
        const VIDEOS_PER_PLAYLIST = 50;

        playlistHistory.innerHTML = playlists.map((p, playlistIndex) => {
            const date = new Date(p.createdAt).toLocaleString();
            const allPlaylistVideos = Array.isArray(p.data) ? p.data : [];
            // Filter out ignored videos from play links and category views
            const videos = allPlaylistVideos.filter(v => v.status !== 'ignored');
            const count = allPlaylistVideos.length;

            // Group active (non-ignored) videos by category
            const categories = {};
            videos.forEach(v => {
                const cat = v.category || 'other';
                if (!categories[cat]) categories[cat] = [];
                categories[cat].push(v);
            });

            // Split active videos into chunks of 50 for play buttons
            const chunks = [];
            for (let i = 0; i < videos.length; i += VIDEOS_PER_PLAYLIST) {
                chunks.push(videos.slice(i, i + VIDEOS_PER_PLAYLIST));
            }

            // Generate play buttons (only non-ignored videos)
            const playButtons = chunks.length > 0 ? chunks.map((chunk, index) => {
                const videoIds = chunk.map(v => v.id).join(',');
                const playlistUrl = `https://www.youtube.com/watch_videos?video_ids=${videoIds}`;
                const label = chunks.length > 1 ? `▶️ Part ${index + 1}` : '▶️ Play';
                return `<a href="${playlistUrl}" target="_blank" class="secondary-btn">${label}</a>`;
            }).join('') : '<span class="playlist-empty-msg">No active videos</span>';

            // Status summary — merge pending + approved into "ready"
            const ready = allPlaylistVideos.filter(v => (v.status || 'pending') === 'pending' || v.status === 'approved').length;
            const extracted = allPlaylistVideos.filter(v => v.status === 'extracted').length;
            const ignored = allPlaylistVideos.filter(v => v.status === 'ignored').length;
            const statusSummary = `📋${ready} 📝${extracted} 🚫${ignored}`;

            // Save to YouTube button (only active videos)
            const allVideoIds = videos.map(v => v.id); // Already filtered — no ignored videos
            const saveButton = isLoggedIn
                ? `<button class="save-youtube-btn" data-title="Playlist ${date}" data-videos='${JSON.stringify(allVideoIds)}'>💾 YouTube</button>`
                : '';

            // Category sections
            const categoryOrder = ['finance', 'news', 'tech', 'sports', 'cooking', 'other'];
            const sortedCategories = Object.entries(categories).sort((a, b) => {
                const orderA = categoryOrder.indexOf(a[0]);
                const orderB = categoryOrder.indexOf(b[0]);
                return (orderA === -1 ? 999 : orderA) - (orderB === -1 ? 999 : orderB);
            });

            const categorySections = sortedCategories.map(([cat, catVideos]) => {
                const categoryVideoIds = catVideos.map(v => v.id).join(',');
                const categoryPlayUrl = `https://www.youtube.com/watch_videos?video_ids=${categoryVideoIds}`;

                return `
                <div class="category-section">
                    <div class="category-header">
                        <span class="category-emoji">${categoryEmojis[cat] || '📺'}</span>
                        <span>${cat.charAt(0).toUpperCase() + cat.slice(1)}</span>
                        <span class="category-count">(${catVideos.length})</span>
                        <a href="${categoryPlayUrl}" target="_blank" class="category-play-btn">▶️ Play ${cat.charAt(0).toUpperCase() + cat.slice(1)}</a>
                    </div>
                    <div class="video-grid">
                        ${catVideos.map(v => `
                            <div class="video-card" data-video-id="${v.id}">
                                <img class="video-thumbnail" src="${v.thumbnail || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`}" alt="" onerror="this.style.display='none'">
                                <div class="video-info">
                                    <a href="https://youtube.com/watch?v=${v.id}" target="_blank" class="video-title" title="${escapeHtml(v.title)}">${escapeHtml(v.title)}</a>
                                    <div class="video-channel">${escapeHtml(v.channelName || 'Unknown')}</div>
                                </div>
                                <div class="video-actions">
                                    <button class="video-delete-btn" data-filename="${p.filename}" data-video-id="${v.id}" title="Remove">✕</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `}).join('');


            return `
                <div class="playlist-card" data-filename="${p.filename}">
                    <div class="playlist-card-header" onclick="this.parentElement.classList.toggle('expanded')">
                        <div class="playlist-meta">
                            <div class="playlist-play-links" onclick="event.stopPropagation()">
                                ${playButtons}
                                ${saveButton}
                            </div>
                            <span class="playlist-date">${date}</span>
                            <span class="playlist-count">${videos.length} active / ${count} total • ${statusSummary}</span>
                        </div>
                        <div class="playlist-actions" onclick="event.stopPropagation()">
                            <button class="expand-btn">📂 Details</button>
                        </div>
                    </div>
                    <div class="collapsed-content">
                        ${categorySections}
                    </div>
                </div>
            `;
        }).join('');

        // Attach event listeners
        attachPlaylistListeners();
    }

    function attachPlaylistListeners() {
        // Delete single video
        document.querySelectorAll('.video-delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const filename = btn.dataset.filename;
                const videoId = btn.dataset.videoId;

                try {
                    const response = await fetch(`/api/playlist/${filename}/video/${videoId}`, { method: 'DELETE' });
                    const data = await response.json();
                    if (data.success) {
                        showSuccess('Video removed.');
                        await loadPlaylists();
                        const playlistCard = document.querySelector(`.playlist-card[data-filename="${filename}"]`);
                        if (playlistCard) {
                            playlistCard.classList.add('expanded');
                            const expandBtn = playlistCard.querySelector('.expand-btn');
                            if (expandBtn) expandBtn.textContent = '📁 Hide';
                        }
                    } else {
                        showError(data.error || 'Failed to remove video.');
                    }
                } catch (error) {
                    console.error('Delete video error:', error);
                    showError('Server error.');
                }
            });
        });

        // Extract transcripts
        document.querySelectorAll('.extract-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!confirm('Extract transcripts for all videos? This may take several minutes.')) return;

                const filename = btn.dataset.filename;
                const playlistCard = btn.closest('.playlist-card');

                btn.disabled = true;
                const originalText = btn.textContent;
                btn.textContent = '⏳ Extracting...';
                btn.style.minWidth = '140px';

                let statusDiv = playlistCard.querySelector('.extraction-status-display');
                if (!statusDiv) {
                    statusDiv = document.createElement('div');
                    statusDiv.className = 'extraction-status-display';
                    statusDiv.style.cssText = 'padding: 0.75rem 1rem; background: rgba(59,130,246,0.1); border-left: 3px solid #3b82f6; margin: 0.5rem 1rem; font-size: 0.85rem; color: #60a5fa;';
                    const header = playlistCard.querySelector('.playlist-card-header');
                    header.after(statusDiv);
                }
                statusDiv.textContent = '📥 Extracting transcripts... Please wait.';

                try {
                    const response = await fetch(`/api/playlist/${filename}/extract-transcripts`, { method: 'POST' });
                    const data = await response.json();

                    if (data.success) {
                        statusDiv.style.borderColor = '#10b981';
                        statusDiv.style.background = 'rgba(16,185,129,0.1)';
                        statusDiv.style.color = '#34d399';
                        statusDiv.textContent = `✅ Done! Extracted ${data.extracted} of ${data.total} transcripts.`;
                        btn.textContent = `✅ ${data.extracted}/${data.total}`;
                        showSuccess(`Extracted ${data.extracted} of ${data.total} transcripts!`);
                    } else {
                        throw new Error(data.error || 'Extraction failed');
                    }
                } catch (error) {
                    console.error('Extract error:', error);
                    statusDiv.style.borderColor = '#ef4444';
                    statusDiv.style.background = 'rgba(239,68,68,0.1)';
                    statusDiv.style.color = '#f87171';
                    statusDiv.textContent = `❌ Error: ${error.message}`;
                    btn.textContent = '❌ Failed';
                    showError(error.message || 'Extraction failed.');
                }

                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.disabled = false;
                }, 5000);
            });
        });

        // Save to YouTube
        document.querySelectorAll('.save-youtube-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const title = btn.dataset.title;
                const videoIds = JSON.parse(btn.dataset.videos);

                btn.disabled = true;
                btn.textContent = '⏳...';

                try {
                    const response = await fetch('/api/playlist/save-to-youtube', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ title, videoIds, privacy: 'private' })
                    });
                    const data = await response.json();

                    if (data.success) {
                        btn.textContent = '✅ Saved!';
                        showSuccess(`Saved to YouTube! ${data.videosAdded}/${data.totalVideos} videos.`);
                        if (data.playlistUrl) window.open(data.playlistUrl, '_blank');
                    } else {
                        throw new Error(data.error || 'Failed to save');
                    }
                } catch (error) {
                    console.error('Save to YouTube error:', error);
                    btn.textContent = '❌';
                    showError(error.message || 'Failed to save to YouTube');
                }

                setTimeout(() => {
                    btn.textContent = '💾 YouTube';
                    btn.disabled = false;
                }, 2000);
            });
        });

        // Expand button
        document.querySelectorAll('.expand-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const card = btn.closest('.playlist-card');
                card.classList.toggle('expanded');
                btn.textContent = card.classList.contains('expanded') ? '📁 Hide' : '📂 View';
            });
        });
    }

    // ============ Generate / Sync Button ============
    generatePlaylistBtn.addEventListener('click', async () => {
        generatePlaylistBtn.disabled = true;
        playlistLoading.classList.remove('hidden');
        syncFeedback.classList.add('hidden');

        console.log('%c🎬 Starting daily feed sync...', 'color: #4CAF50; font-weight: bold');

        try {
            const response = await fetch('/api/playlist/generate', { method: 'POST' });
            const data = await response.json();

            // Display logs in browser console
            if (data.logs && Array.isArray(data.logs)) {
                console.group('%c📋 Feed Sync Logs', 'color: #2196F3; font-weight: bold');
                data.logs.forEach(entry => {
                    const style = entry.type === 'error' ? 'color: red'
                        : entry.type === 'warn' ? 'color: orange'
                            : 'color: #333';
                    console.log(`%c[${entry.timestamp}] ${entry.message}`, style);
                });
                console.groupEnd();
            }

            if (data.success) {
                // Show sync feedback banner
                syncFeedback.classList.remove('hidden');
                document.querySelector('#syncNew strong').textContent = data.newCount || 0;
                document.querySelector('#syncDeduped strong').textContent = data.dbDeduped || 0;
                document.querySelector('#syncFiltered strong').textContent = data.filterDropped || 0;
                document.querySelector('#syncTotal strong').textContent = data.videoCount || 0;

                showSuccess(`Sync complete! ${data.newCount || 0} new videos added.`);

                // Reload workspace
                await loadDailyWorkspace();
            } else {
                showError(data.error || data.message || 'Failed to sync daily feed.');
            }
        } catch (error) {
            console.error('Sync error:', error);
            showError('Failed to trigger sync.');
        } finally {
            generatePlaylistBtn.disabled = false;
            playlistLoading.classList.add('hidden');
        }
    });

    // V3: Discover button handler
    if (discoverBtn) {
        discoverBtn.addEventListener('click', async () => {
            discoverBtn.disabled = true;
            discoverBtn.textContent = '⏳ Discovering...';
            playlistLoading.classList.remove('hidden');

            try {
                const response = await fetch('/api/playlist/discover', { method: 'POST' });
                const data = await response.json();

                if (data.success) {
                    // Show discovery feedback
                    syncFeedback.classList.remove('hidden');
                    document.getElementById('syncNew').innerHTML = `✨ <strong>${data.addedToDaily || 0}</strong> discovered`;
                    document.getElementById('syncDeduped').innerHTML = `🔎 <strong>${data.searchesRun || 0}</strong> searches`;
                    document.getElementById('syncFiltered').innerHTML = `📦 <strong>${data.candidatesFound || 0}</strong> candidates`;
                    document.getElementById('syncTotal').innerHTML = `✅ <strong>${data.keptAfterFilter || 0}</strong> kept`;

                    if (data.addedToDaily > 0) {
                        showSuccess(`✨ Discovered ${data.addedToDaily} new videos!`);
                    } else {
                        showSuccess('Discovery complete — no new videos found this time.');
                    }

                    await loadDailyWorkspace();
                } else {
                    showError(data.error || 'Discovery failed.');
                }
            } catch (error) {
                console.error('Discovery error:', error);
                showError('Failed to run discovery.');
            } finally {
                discoverBtn.disabled = false;
                discoverBtn.textContent = '✨ Discover';
                playlistLoading.classList.add('hidden');
            }
        });
    }

    async function saveChannels() {
        try {
            const response = await fetch('/api/playlist/channels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channels: channelsData })
            });
            const data = await response.json();
            return data.success;
        } catch (error) {
            console.error('Save channels error:', error);
            showError('Failed to save channels.');
            return false;
        }
    }

    // Add Channel Functionality
    const newChannelName = document.getElementById('newChannelName');
    const newChannelUrl = document.getElementById('newChannelUrl');
    const newChannelShorts = document.getElementById('newChannelShorts');
    const addChannelBtn = document.getElementById('addChannelBtn');

    addChannelBtn.addEventListener('click', async () => {
        const name = newChannelName.value.trim();
        let url = newChannelUrl.value.trim();

        if (!name || !url) {
            showError('Please enter both name and URL.');
            return;
        }

        if (!url.startsWith('http')) {
            url = 'https://www.youtube.com/@' + url;
        }

        if (channelsData.some(c => c.url === url || c.name.toLowerCase() === name.toLowerCase())) {
            showError('Channel already exists.');
            return;
        }

        channelsData.push({
            name: name,
            url: url,
            include_shorts: newChannelShorts.checked
        });

        const saved = await saveChannels();
        if (saved) {
            newChannelName.value = '';
            newChannelUrl.value = '';
            newChannelShorts.checked = false;
            renderChannels();
            showSuccess(`Added channel: ${name}`);
        }
    });

    // ============ Initial Load ============
    loadChannels();
    checkAuthStatus();
    loadDailyWorkspace();
    loadFilters();

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            modal.classList.add('hidden');
            deleteModal.classList.add('hidden');
            deleteTargetId = null;
        }
    });

    // ========================================
    // DELETE PLAYLIST - Document-level event delegation
    // ========================================
    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('.delete-playlist-btn');
        if (!btn) return;

        e.stopPropagation();
        e.preventDefault();

        const filename = btn.dataset.filename;
        console.log('[DELETE PLAYLIST] Button clicked for:', filename);

        if (btn.dataset.primed !== 'true') {
            btn.dataset.primed = 'true';
            btn.innerHTML = '⚠️ Sure?';
            btn.style.background = 'rgba(239, 68, 68, 0.3)';
            btn.style.borderColor = '#ef4444';
            btn.style.width = 'auto';
            btn.style.minWidth = '70px';

            setTimeout(() => {
                if (btn.dataset.primed === 'true') {
                    btn.dataset.primed = '';
                    btn.innerHTML = '🗑️';
                    btn.style.cssText = '';
                }
            }, 3000);
            return;
        }

        btn.dataset.primed = '';
        btn.innerHTML = '⏳';
        btn.disabled = true;

        try {
            const response = await fetch(`/api/playlist/${filename}`, { method: 'DELETE' });
            const data = await response.json();

            if (data.success) {
                showSuccess('Playlist deleted!');
                loadPlaylists();
                loadDailyWorkspace();
            } else {
                showError('Failed: ' + (data.error || 'Unknown'));
                btn.innerHTML = '🗑️';
                btn.style.cssText = '';
                btn.disabled = false;
            }
        } catch (error) {
            console.error('[DELETE PLAYLIST] Error:', error);
            showError('Server error: ' + error.message);
            btn.innerHTML = '🗑️';
            btn.style.cssText = '';
            btn.disabled = false;
        }
    }, true);

    // ============ Settings Modal ============
    const settingsModal = document.getElementById('settingsModal');
    const settingsGear = document.getElementById('settingsGear');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    const ollamaEndpointInput = document.getElementById('ollamaEndpoint');
    const ollamaModelSelect = document.getElementById('ollamaModel');
    const testConnectionBtn = document.getElementById('testConnectionBtn');
    const refreshModelsBtn = document.getElementById('refreshModelsBtn');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    const connectionStatus = document.getElementById('connectionStatus');

    // Open settings
    settingsGear.addEventListener('click', async () => {
        settingsModal.classList.remove('hidden');
        // Load current settings
        try {
            const resp = await fetch('/api/settings');
            const data = await resp.json();
            if (data.success) {
                ollamaEndpointInput.value = data.settings.ollama_endpoint || '';
                // Load models then set selected
                await loadOllamaModels(data.settings.ollama_model);
            }
        } catch (e) {
            console.error('Settings load error:', e);
        }
    });

    // Close settings
    closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) settingsModal.classList.add('hidden');
    });

    // Test connection
    testConnectionBtn.addEventListener('click', async () => {
        let endpoint = ollamaEndpointInput.value.trim();

        // Validate URL format
        if (!endpoint) {
            connectionStatus.textContent = '❌ Please enter an Ollama endpoint URL';
            connectionStatus.className = 'connection-status status-error';
            return;
        }
        // Fix common mistake: http:host instead of http://host
        if (endpoint.match(/^https?:[^/]/)) {
            endpoint = endpoint.replace(/^(https?:)/, '$1//');
            ollamaEndpointInput.value = endpoint;
        }
        // Strip trailing slash
        endpoint = endpoint.replace(/\/+$/, '');
        ollamaEndpointInput.value = endpoint;

        connectionStatus.textContent = '⏳ Saving endpoint & testing...';
        connectionStatus.className = 'connection-status';

        try {
            // Save endpoint FIRST so backend uses it
            const saveResp = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ollama_endpoint: endpoint })
            });
            const saveText = await saveResp.text();
            // Check if server returned HTML (routes not loaded — server needs restart)
            if (saveText.startsWith('<!DOCTYPE') || saveText.startsWith('<html')) {
                connectionStatus.textContent = '❌ Server needs restart! New routes not loaded.';
                connectionStatus.className = 'connection-status status-error';
                return;
            }

            // Now test connection
            const resp = await fetch('/api/ollama/models');
            const text = await resp.text();
            if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
                connectionStatus.textContent = '❌ Server needs restart! API routes not available.';
                connectionStatus.className = 'connection-status status-error';
                return;
            }
            const data = JSON.parse(text);
            if (data.success) {
                connectionStatus.textContent = `✅ Connected! ${data.models.length} models available`;
                connectionStatus.className = 'connection-status status-ok';
                populateModels(data.models);
            } else {
                connectionStatus.textContent = `❌ ${data.error}`;
                connectionStatus.className = 'connection-status status-error';
            }
        } catch (e) {
            connectionStatus.textContent = `❌ Connection failed: ${e.message}`;
            connectionStatus.className = 'connection-status status-error';
        }
    });

    // Load models from Ollama
    async function loadOllamaModels(selectedModel) {
        try {
            // Save endpoint first so backend uses it
            await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ollama_endpoint: ollamaEndpointInput.value })
            });

            const resp = await fetch('/api/ollama/models');
            const data = await resp.json();
            if (data.success) {
                populateModels(data.models, selectedModel);
            }
        } catch (e) {
            console.error('Model fetch error:', e);
        }
    }

    function populateModels(models, selectedModel) {
        ollamaModelSelect.innerHTML = '<option value="">— Select a model —</option>';
        models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.name;
            const sizeMB = m.size ? `(${(m.size / 1e9).toFixed(1)}GB)` : '';
            opt.textContent = `${m.name} ${sizeMB}`;
            if (m.name === selectedModel) opt.selected = true;
            ollamaModelSelect.appendChild(opt);
        });
    }

    // Refresh models button
    refreshModelsBtn.addEventListener('click', () => loadOllamaModels());

    // Save settings
    saveSettingsBtn.addEventListener('click', async () => {
        saveSettingsBtn.disabled = true;
        saveSettingsBtn.textContent = '⏳ Saving...';
        try {
            const resp = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ollama_endpoint: ollamaEndpointInput.value,
                    ollama_model: ollamaModelSelect.value
                })
            });
            const data = await resp.json();
            if (data.success) {
                saveSettingsBtn.textContent = '✅ Saved!';
                setTimeout(() => {
                    saveSettingsBtn.textContent = '💾 Save Settings';
                    saveSettingsBtn.disabled = false;
                }, 1500);
            }
        } catch (e) {
            saveSettingsBtn.textContent = '❌ Error';
            setTimeout(() => {
                saveSettingsBtn.textContent = '💾 Save Settings';
                saveSettingsBtn.disabled = false;
            }, 2000);
        }
    });

    // ============ Modal Summarize Button ============
    document.getElementById('modalSummarizeBtn').addEventListener('click', async () => {
        if (!currentModalVideoId) return;
        const btn = document.getElementById('modalSummarizeBtn');
        const summarySection = document.getElementById('modalSummarySection');
        const summaryContent = document.getElementById('modalSummary');
        const selectedModel = document.getElementById('modalModelSelect').value;

        btn.disabled = true;
        btn.textContent = '⏳ Summarizing...';

        try {
            const body = selectedModel ? { model: selectedModel } : {};
            const resp = await fetch(`/api/summarize/${currentModalVideoId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await resp.json();

            if (data.success) {
                summaryContent.innerHTML = data.summary.replace(/\n/g, '<br>');
                summarySection.classList.remove('hidden');
                btn.textContent = '🔄 Re-Summarize';
                btn.disabled = false;
                // Update local data
                const v = allVideos.find(v => v.id == currentModalVideoId);
                if (v) v.summary = data.summary;
            } else {
                alert(data.error || 'Summarization failed');
                btn.textContent = '🤖 Summarize';
                btn.disabled = false;
            }
        } catch (err) {
            console.error('Modal summarize error:', err);
            alert('Summarization failed: ' + err.message);
            btn.textContent = '🤖 Summarize';
            btn.disabled = false;
        }
    });

    // ============ Summarize All Button (with Progress Banner) ============
    document.getElementById('summarizeAllBtn').addEventListener('click', async () => {
        console.log('[Summarize All] Button clicked!');
        console.log('[Summarize All] allVideos count:', allVideos.length);

        const unsummarized = allVideos.filter(v => !v.summary && v.transcript_length > 50);
        console.log('[Summarize All] Unsummarized videos found:', unsummarized.length);

        if (unsummarized.length === 0) {
            console.log('[Summarize All] No unsummarized videos — aborting');
            alert('All videos are already summarized!');
            return;
        }

        console.log('[Summarize All] Starting batch summarization...');

        const btn = document.getElementById('summarizeAllBtn');
        btn.disabled = true;

        // Show progress banner
        const progressDiv = document.getElementById('summarizeProgress');
        const statusEl = document.getElementById('sumProgressStatus');
        const countsEl = document.getElementById('sumProgressCounts');
        const titleEl = document.getElementById('sumProgressTitle');
        const barEl = document.getElementById('sumProgressBar');
        const successEl = document.getElementById('sumStatSuccess');
        const failEl = document.getElementById('sumStatFail');
        const logEl = document.getElementById('sumResultsLog');

        console.log('[Summarize All] Progress banner element:', progressDiv ? 'found' : 'MISSING!');

        progressDiv.classList.remove('hidden');
        logEl.innerHTML = '';
        barEl.style.width = '0%';
        statusEl.textContent = '🤖 Summarizing...';
        countsEl.textContent = `0 / ${unsummarized.length}`;
        titleEl.textContent = '—';
        successEl.textContent = '✅ 0';
        failEl.textContent = '❌ 0';

        console.log('[Summarize All] Progress banner shown, starting loop...');

        let success = 0, fail = 0;
        for (let i = 0; i < unsummarized.length; i++) {
            const v = unsummarized[i];
            const pct = Math.round(((i + 1) / unsummarized.length) * 100);
            titleEl.textContent = v.title || 'Untitled';
            countsEl.textContent = `${i + 1} / ${unsummarized.length}`;
            barEl.style.width = `${pct}%`;
            btn.textContent = `⏳ ${i + 1}/${unsummarized.length}`;

            console.log(`[Summarize All] Processing ${i + 1}/${unsummarized.length}: "${v.title}" (id: ${v.id})`);

            try {
                const resp = await fetch(`/api/summarize/${v.id}`, { method: 'POST' });
                const data = await resp.json();
                if (data.success) {
                    success++;
                    v.summary = data.summary;
                    console.log(`[Summarize All] ✅ Success: "${v.title}" (${data.summary?.length || 0} chars)`);
                    logEl.innerHTML += `<div class="sum-log-success">✅ ${escapeHtml(v.title || 'Untitled')}</div>`;
                    renderVideos(allVideos); // Live update: move card to summarized column
                } else {
                    fail++;
                    console.log(`[Summarize All] ❌ Failed: "${v.title}" — ${data.error || 'Unknown error'}`);
                    logEl.innerHTML += `<div class="sum-log-fail">❌ ${escapeHtml(v.title || 'Untitled')} — ${data.error || 'Failed'}</div>`;
                }
            } catch (e) {
                fail++;
                console.error(`[Summarize All] ❌ Error: "${v.title}" — ${e.message}`);
                logEl.innerHTML += `<div class="sum-log-fail">❌ ${escapeHtml(v.title || 'Untitled')} — ${e.message}</div>`;
            }
            successEl.textContent = `✅ ${success}`;
            failEl.textContent = `❌ ${fail}`;
            logEl.scrollTop = logEl.scrollHeight;
        }

        // Done
        console.log(`[Summarize All] ✅ Complete! ${success} succeeded, ${fail} failed out of ${unsummarized.length}`);
        statusEl.textContent = '✅ Complete!';
        barEl.style.width = '100%';
        btn.textContent = `✅ ${success}/${unsummarized.length}`;
        loadVideos(); // Final refresh
        setTimeout(() => {
            btn.textContent = '🤖 Summarize All';
            btn.disabled = false;
        }, 5000);
    });

    // ============ Generate News Report Button ============
    document.getElementById('generateReportBtn').addEventListener('click', async () => {
        console.log('[News Report] Generate button clicked');
        const btn = document.getElementById('generateReportBtn');

        btn.disabled = true;
        btn.textContent = '... GENERATING';
        reportViewer.innerHTML = `
            <div class="report-loading">
                <div class="spinner"></div>
                <p>GENERATING DAILY INTEL BRIEFING...</p>
                <p class="subtext">This may take 30-60 seconds</p>
            </div>`;

        console.log('[News Report] Sending request to /api/news-report...');

        try {
            const resp = await fetch('/api/news-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hours: 24 })
            });
            const data = await resp.json();
            console.log('[News Report] Response:', data.success ? 'Success' : data.error);

            if (data.success) {
                const formattedReport = formatReportText(data.report);
                const timestamp = new Date(data.generatedAt).toLocaleString();
                reportViewer.innerHTML = `
                    <div class="report-display">
                        <div class="report-display-meta">
                            ${timestamp} · ${data.videoCount} sources · Report #${data.reportId || '?'}
                        </div>
                        <div class="report-display-content">${formattedReport}</div>
                    </div>`;

                console.log(`[News Report] Displayed report (${data.report.length} chars from ${data.videoCount} videos)`);

                // Refresh report history
                loadReports();
            } else {
                reportViewer.innerHTML = `<p class="term-empty term-error">${escapeHtml(data.error || 'Failed to generate report')}</p>`;
                console.error('[News Report] Error:', data.error);
            }
        } catch (err) {
            reportViewer.innerHTML = `<p class="term-empty term-error">${escapeHtml(err.message)}</p>`;
            console.error('[News Report] Fetch error:', err.message);
        }

        btn.textContent = '⚡ GENERATE';
        btn.disabled = false;
    });
});

// ============ Dev Controls ============
document.addEventListener('DOMContentLoaded', () => {
    const resetBtn = document.getElementById('devResetStatuses');
    const resultSpan = document.getElementById('devResetResult');

    if (resetBtn) {
        resetBtn.addEventListener('click', async () => {
            if (!confirm('⚠️ This will reset ALL video statuses (approved, ignored, extracted) back to pending.\\n\\nAre you sure?')) {
                return;
            }

            resetBtn.disabled = true;
            resetBtn.textContent = '⏳ Resetting...';
            resultSpan.textContent = '';

            try {
                const resp = await fetch('/api/dev/reset-statuses', { method: 'POST' });
                const data = await resp.json();

                if (data.success) {
                    resultSpan.textContent = `✅ ${data.message}`;
                    resultSpan.style.color = '#558b2f';
                    // Reload page to reflect reset changes
                    setTimeout(() => window.location.reload(), 1000);
                } else {
                    resultSpan.textContent = `❌ ${data.error || 'Reset failed'}`;
                    resultSpan.style.color = '#c62828';
                }
            } catch (err) {
                resultSpan.textContent = `❌ ${err.message}`;
                resultSpan.style.color = '#c62828';
            }

            resetBtn.textContent = '🔄 Reset All Video Statuses';
            resetBtn.disabled = false;
        });
    }
});
