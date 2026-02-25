/**
 * NaviPlaylist 前端逻辑
 * - 解析文本列表，调用后端搜索
 * - 流式接收结果，实时更新左右分栏
 * - 多选时弹出选择框
 * - 确认后通过 Subsonic API 在 Navidrome 服务端创建歌单
 */

(function () {
  const playlistNameEl = document.getElementById('playlistName');
  const songListEl = document.getElementById('songList');
  const btnSearch = document.getElementById('btnSearch');
  const btnGenerate = document.getElementById('btnGenerate');
  const matchedListEl = document.getElementById('matchedList');
  const missingListEl = document.getElementById('missingList');
  const progressTextEl = document.getElementById('progressText');
  const generateHintEl = document.getElementById('generateHint');
  const modal = document.getElementById('modal');
  const modalQueryEl = document.getElementById('modalQuery');
  const modalListEl = document.getElementById('modalList');
  const modalSkip = document.getElementById('modalSkip');
  const modalCancel = document.getElementById('modalCancel');
  const btnClear = document.getElementById('btnClear');
  const chkAutoSelect = document.getElementById('chkAutoSelect');

  // 连接状态相关元素
  const connectionStatusEl = document.getElementById('connectionStatus');
  const statusTextEl = document.getElementById('statusText');
  const statusDetailsEl = document.getElementById('statusDetails');
  const usernameDisplayEl = document.getElementById('usernameDisplay');
  const btnRetry = document.getElementById('btnRetry');
  const connectionErrorHintEl = document.getElementById('connectionErrorHint');
  const errorMessageEl = document.getElementById('errorMessage');
  const errorSuggestionEl = document.getElementById('errorSuggestion');
  const btnCopyMissing = document.getElementById('btnCopyMissing');
  const versionBadgeEl = document.getElementById('versionBadge');
  const btnAIGuide = document.getElementById('btnAIGuide');
  const aiGuideModal = document.getElementById('aiGuideModal');
  const aiGuideClose = document.getElementById('aiGuideClose');
  const footerVersionEl = document.getElementById('footerVersion');
  const mobileVersionEl = document.getElementById('mobileVersion');

  // 加载状态控制函数
  function setLoadingState(loading) {
    if (!btnSearch) return;
    
    if (loading) {
      btnSearch.classList.add('btn-loading');
      btnSearch.disabled = true;
    } else {
      btnSearch.classList.remove('btn-loading');
      btnSearch.disabled = false;
    }
  }

  // 连接状态
  let isConnected = false;
  let connectionChecked = false;

  // 格式化显示：歌名（绿色加粗） - 歌手（灰色小号） 【专辑名（灰色小号）】
  function formatSongDisplayHtml(song) {
    const title = escapeHtml((song.title || '').trim());
    const artist = escapeHtml((song.artist || '').trim());
    const album = escapeHtml((song.album || '').trim());
    const meta = album ? ` - <span class="song-meta">${artist}</span> <span class="song-meta">【${album}】</span>` : ` - <span class="song-meta">${artist}</span>`;
    return `<span class="song-title">${title}</span>${meta}`;
  }

  // 连接状态管理函数
  function updateConnectionUI(connected, data) {
    // 防御性编程：检查关键元素是否存在
    if (!connectionStatusEl || !statusTextEl || !btnRetry || !connectionErrorHintEl ||
        !btnSearch || !statusDetailsEl || !usernameDisplayEl ||
        !errorMessageEl || !errorSuggestionEl) {
      console.error('updateConnectionUI: 缺少必要的DOM元素');
      return;
    }
    
    connectionChecked = true;
    isConnected = connected;
    
    // 更新状态指示器
    connectionStatusEl.classList.remove('status-connected', 'status-disconnected', 'status-checking');
    
    if (connected) {
      // 连接成功
      connectionStatusEl.classList.add('status-connected');
      
      // 构建状态文本：服务器已连接: [IP/域名脱敏]
      let statusText = '🟢 服务器已连接';
      if (data && data.serverUrl) {
        // 服务器URL应该已经由后端脱敏处理
        statusText += `: ${data.serverUrl}`;
      }
      statusTextEl.textContent = statusText;
      
      // 显示用户名（如果有）
      if (data && data.username) {
        usernameDisplayEl.textContent = `| 用户: ${data.username}`;
        statusDetailsEl.classList.remove('hidden');
      } else {
        statusDetailsEl.classList.add('hidden');
      }
      
      // 更新版本号（如果后端返回了版本号）
      if (data && data.version && versionBadgeEl) {
        versionBadgeEl.textContent = `v${data.version}`;
        if (footerVersionEl) footerVersionEl.textContent = data.version;
        if (mobileVersionEl) mobileVersionEl.textContent = data.version;
      }
      
      // 隐藏重试按钮和错误提示
      btnRetry.classList.add('hidden');
      connectionErrorHintEl.classList.add('hidden');
      
      // 启用搜索按钮
      btnSearch.disabled = false;
    } else {
      // 连接失败
      connectionStatusEl.classList.add('status-disconnected');
      statusTextEl.textContent = '🔴 连接失败';
      
      // 显示错误详情
      if (data && data.message) {
        errorMessageEl.textContent = data.message;
        statusDetailsEl.classList.remove('hidden');
        usernameDisplayEl.textContent = data.message;
      }
      
      // 显示错误建议
      if (data && data.reason === 'auth_error') {
        errorSuggestionEl.textContent = '请检查服务器地址、用户名和密码等配置是否正确';
      } else if (data && data.reason === 'network_error') {
        errorSuggestionEl.textContent = '请检查网络连接和服务器URL是否正确';
      } else if (data && data.reason === 'timeout_error') {
        errorSuggestionEl.textContent = '连接超时，请检查网络或服务器状态';
      } else if (data && data.reason === 'init_error') {
        errorSuggestionEl.textContent = '初始化失败，请刷新页面重试';
      } else {
        errorSuggestionEl.textContent = '请检查服务器配置和网络连接';
      }
      
      // 显示重试按钮和错误提示
      btnRetry.classList.remove('hidden');
      connectionErrorHintEl.classList.remove('hidden');
      
      // 禁用搜索按钮并显示提示
      btnSearch.disabled = true;
    }
  }

  // 检测连接状态
    async function checkConnectionStatus() {
      try {
        // 设置超时（5秒）
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch('/api/status', {
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        
        if (data.connected) {
          updateConnectionUI(true, data);
        } else {
          updateConnectionUI(false, data);
        }
      } catch (error) {
        console.error('检测连接状态失败:', error);
        let reason = 'network_error';
        let message = '无法连接服务器，请检查 URL';
        
        if (error.name === 'AbortError') {
          reason = 'timeout_error';
          message = '连接超时，请检查网络或服务器状态';
        } else if (error.message.includes('Failed to fetch')) {
          reason = 'network_error';
          message = '无法连接到服务器，请检查 URL 和网络连接';
        }
        
        updateConnectionUI(false, {
          reason: reason,
          message: message
        });
      }
    }

  // 初始化连接状态检测
  async function initConnectionCheck() {
    // 防御性编程：检查元素是否存在
    if (!connectionStatusEl || !statusTextEl) {
      console.error('DOM元素未找到，无法初始化连接检测');
      return;
    }
    
    // 设置检查状态
    connectionStatusEl.classList.add('status-checking');
    statusTextEl.textContent = '检测连接状态...';
    
    // 设置超时兜底：如果10秒内没有完成，强制切换到失败状态
    const timeoutId = setTimeout(() => {
      console.warn('连接检测超时，强制切换到失败状态');
      if (connectionStatusEl && statusTextEl) {
        updateConnectionUI(false, {
          reason: 'timeout_error',
          message: '连接检测超时'
        });
      }
    }, 10000);
    
    try {
      // 执行检测
      await checkConnectionStatus();
    } catch (error) {
      // 如果checkConnectionStatus内部抛出未捕获的错误，这里作为最后的安全网
      console.error('初始化连接检测失败:', error);
      updateConnectionUI(false, {
        reason: 'init_error',
        message: '初始化连接检测失败'
      });
    } finally {
      // 清除超时定时器
      clearTimeout(timeoutId);
    }
    
    // 设置定期检测（每5分钟一次）
    setInterval(checkConnectionStatus, 5 * 60 * 1000);
  }

  // 状态：匹配结果 [{ query, status, song? }]
  let matchResults = [];
  let selectedSongs = []; // 最终选中的歌曲（含多选时用户选的）

  // 开始匹配
  btnSearch.addEventListener('click', async () => {
    // 检查连接状态
    if (!isConnected) {
      alert('请先修复服务器连接后再开始匹配');
      return;
    }
    
    const raw = songListEl.value.trim();
    if (!raw) {
      alert('请输入歌曲列表');
      return;
    }
    const items = raw.split('\n').map(s => s.trim()).filter(Boolean);
    if (items.length === 0) {
      alert('请输入至少一行');
      return;
    }

    // 设置加载状态
    setLoadingState(true);
    matchResults = [];
    selectedSongs = [];
    matchedListEl.innerHTML = '';
    missingListEl.innerHTML = '';
    progressTextEl.innerHTML = '<span>匹配 <span class="text-green-600 font-bold">0</span> 首，缺失 <span class="text-red-600 font-bold">0</span> 首</span>';
    generateHintEl.classList.add('hidden');
    btnGenerate.disabled = true;

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      });
      if (!response.ok) {
        throw new Error('搜索请求失败');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentMultiIndex = -1;
      let resolveMulti = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          let ev;
          try {
            ev = JSON.parse(line);
          } catch (_) {
            continue;
          }

          if (ev.type === 'progress') {
            progressTextEl.textContent = `正在搜索 ${ev.index + 1}/${ev.total}: ${ev.query}`;
          } else if (ev.type === 'result') {
            console.log('搜索结果:', ev);
            const songs = ev.songs || [];
            const autoSelect = chkAutoSelect && chkAutoSelect.checked;
            if (ev.status === 'unique' && songs.length === 1) {
              const song = songs[0];
              matchResults.push({ query: ev.query, status: 'matched', song });
              selectedSongs.push(song);
              appendMatched(song);
            } else if (ev.status === 'multiple' && songs.length > 1) {
              let song;
              if (autoSelect) {
                song = songs[0];
              } else {
                song = await showMultiSelect(ev.query, songs);
              }
              if (song) {
                matchResults.push({ query: ev.query, status: 'matched', song });
                selectedSongs.push(song);
                appendMatched(song);
              } else {
                matchResults.push({ query: ev.query, status: 'missing' });
                appendMissing(ev.query);
              }
            } else {
              matchResults.push({ query: ev.query, status: 'missing' });
              appendMissing(ev.query);
            }
          } else if (ev.type === 'done') {
            const missingCount = matchResults.filter(r => r.status === 'missing').length;
            progressTextEl.innerHTML = `<span>匹配 <span class="text-green-600 font-bold">${selectedSongs.length}</span> 首，缺失 <span class="text-red-600 font-bold">${missingCount}</span> 首</span>`;
            generateHintEl.classList.remove('hidden');
            
            // 显示或隐藏复制失败项按钮
            if (missingCount > 0) {
              btnCopyMissing.classList.remove('hidden');
            } else {
              btnCopyMissing.classList.add('hidden');
            }
            
            if (selectedSongs.length > 0) {
              btnGenerate.disabled = false;
            }
          }
        }
      }
    } catch (err) {
      progressTextEl.textContent = '错误：' + err.message;
      console.error(err);
    } finally {
      // 清除加载状态
      setLoadingState(false);
    }
  });

  // 显示多选弹窗，返回用户选择的歌曲或 null
  function showMultiSelect(query, songs) {
    return new Promise(resolve => {
      modalQueryEl.textContent = query;
      modalListEl.innerHTML = '';
      songs.forEach((song, i) => {
        const li = document.createElement('li');
        li.className = 'flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer border border-transparent hover:border-slate-200';
        li.dataset.index = i;
        li.innerHTML = `<span class="matched-item">${formatSongDisplayHtml(song)}</span>`;
        li.addEventListener('click', () => {
          modal.classList.add('hidden');
          modal.style.display = 'none';
          resolve(songs[parseInt(li.dataset.index, 10)]);
        });
        modalListEl.appendChild(li);
      });

      modalSkip.onclick = () => {
        modal.classList.add('hidden');
        modal.style.display = 'none';
        resolve(null);
      };
      modalCancel.onclick = () => {
        modal.classList.add('hidden');
        modal.style.display = 'none';
        resolve(null);
      };

      modal.classList.remove('hidden');
      modal.style.display = 'flex';
    });
  }

  function appendMatched(song) {
    const li = document.createElement('li');
    li.className = 'matched-item';
    li.innerHTML = formatSongDisplayHtml(song);
    matchedListEl.appendChild(li);
  }

  function appendMissing(query) {
    const li = document.createElement('li');
    li.className = 'flex items-center justify-between group hover:bg-red-50 px-2 rounded';
    
    // 解析查询字符串：格式为 "歌曲名 - 歌手名"
    let songName = query;
    let artistName = '';
    
    const separatorIndex = query.indexOf(' - ');
    if (separatorIndex !== -1) {
      songName = query.substring(0, separatorIndex).trim();
      artistName = query.substring(separatorIndex + 3).trim();
    }
    
    // 创建格式化文本：歌曲名（红色） - 歌手名（灰色）
    const textSpan = document.createElement('span');
    textSpan.className = 'truncate flex-1';
    
    if (artistName) {
      // 格式：[歌曲名] - [歌手名]，歌曲名红色，歌手名灰色
      textSpan.innerHTML = `<span class="text-red-500 font-medium">${escapeHtml(songName)}</span> - <span class="text-slate-600">${escapeHtml(artistName)}</span>`;
    } else {
      // 如果没有分隔符，整个文本显示为红色
      textSpan.innerHTML = `<span class="text-red-500 font-medium">${escapeHtml(songName)}</span>`;
    }
    
    const copyButton = document.createElement('button');
    copyButton.className = 'copy-missing-item ml-2 text-slate-400 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-slate-100';
    copyButton.innerHTML = '📋';
    copyButton.title = '复制此项';
    copyButton.setAttribute('data-query', query);
    
    li.appendChild(textSpan);
    li.appendChild(copyButton);
    missingListEl.appendChild(li);
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  // 清空
  btnClear.addEventListener('click', () => {
    playlistNameEl.value = '';
    songListEl.value = '';
    matchResults = [];
    selectedSongs = [];
    matchedListEl.innerHTML = '';
    missingListEl.innerHTML = '';
    progressTextEl.innerHTML = '<span>匹配 <span class="text-green-600 font-bold">0</span> 首，缺失 <span class="text-red-600 font-bold">0</span> 首</span>';
    generateHintEl.classList.add('hidden');
    btnGenerate.disabled = true;
    // 隐藏复制按钮
    btnCopyMissing.classList.add('hidden');
  });

  // 生成歌单
  btnGenerate.addEventListener('click', async () => {
    const name = playlistNameEl.value.trim();
    if (!name) {
      alert('请输入歌单名称');
      return;
    }
    if (selectedSongs.length === 0) {
      alert('没有可生成的歌曲');
      return;
    }

    btnGenerate.disabled = true;
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlistName: name.trim(), songs: selectedSongs })
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message || '歌单已直接创建至 Navidrome 服务端');
      } else {
        alert('生成失败：' + (data.error || '未知错误'));
      }
    } catch (err) {
      alert('请求失败：' + err.message);
    } finally {
      btnGenerate.disabled = false;
    }
  });

  // 重试按钮点击事件
  btnRetry.addEventListener('click', async () => {
    btnRetry.disabled = true;
    statusTextEl.textContent = '重新检测中...';
    await checkConnectionStatus();
    btnRetry.disabled = false;
  });

  // AI指南按钮点击事件
  btnAIGuide.addEventListener('click', () => {
    aiGuideModal.classList.remove('hidden');
    aiGuideModal.style.display = 'flex';
  });

  // AI指南关闭按钮
  aiGuideClose.addEventListener('click', () => {
    aiGuideModal.classList.add('hidden');
    aiGuideModal.style.display = 'none';
  });


  // 安全的复制函数 - 兼容非HTTPS环境和Docker
  function safeCopy(text, callback) {
    // 检查 clipboard API 是否可用且在安全上下文中
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text)
        .then(() => {
          if (callback) callback();
        })
        .catch(err => {
          console.warn('Clipboard API 失败，降级到 execCommand:', err);
          // 降级方案
          fallbackCopy(text, callback);
        });
    } else {
      // 降级方案：使用 document.execCommand
      fallbackCopy(text, callback);
    }
  }

  // 降级复制方案：通过隐藏 textarea
  function fallbackCopy(text, callback) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "0";
    textArea.style.width = "1px";
    textArea.style.height = "1px";
    textArea.style.padding = "0";
    textArea.style.border = "none";
    textArea.style.outline = "none";
    textArea.style.boxShadow = "none";
    textArea.style.background = "transparent";
    
    document.body.appendChild(textArea);
    textArea.select();
    
    try {
      const successful = document.execCommand('copy');
      if (successful) {
        if (callback) callback();
      } else {
        throw new Error('execCommand 复制失败');
      }
    } catch (err) {
      console.error('复制失败:', err);
      alert('复制失败，请手动选择并复制文本');
    } finally {
      document.body.removeChild(textArea);
    }
  }

  // 点击Modal外部关闭
  aiGuideModal.addEventListener('click', (e) => {
    if (e.target === aiGuideModal) {
      aiGuideModal.classList.add('hidden');
      aiGuideModal.style.display = 'none';
    }
  });

  // 缺失项复制图标点击事件（事件委托）
  missingListEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('copy-missing-item') ||
        e.target.closest('.copy-missing-item')) {
      const button = e.target.classList.contains('copy-missing-item') ?
                     e.target : e.target.closest('.copy-missing-item');
      const query = button.getAttribute('data-query');
      
      if (!query) return;
      
      safeCopy(query, () => {
        // 视觉反馈：图标闪烁
        const originalHTML = button.innerHTML;
        button.innerHTML = '✅';
        button.classList.add('text-green-500');
        
        setTimeout(() => {
          button.innerHTML = originalHTML;
          button.classList.remove('text-green-500');
        }, 1000);
      });
    }
  });

  // AI指南模板复制功能
  document.querySelectorAll('.copy-template').forEach(button => {
    button.addEventListener('click', (e) => {
      const templateId = e.target.getAttribute('data-template');
      const templateEl = document.getElementById(templateId);
      if (!templateEl) return;
      
      const text = templateEl.textContent;
      safeCopy(text, () => {
        const originalText = e.target.textContent;
        e.target.textContent = '✅ 已复制';
        e.target.classList.add('bg-emerald-100', 'text-emerald-700');
        
        setTimeout(() => {
          e.target.textContent = originalText;
          e.target.classList.remove('bg-emerald-100', 'text-emerald-700');
        }, 2000);
      });
    });
  });

  // 复制所有缺失项到剪贴板
  function copyMissingItems() {
    const missingItems = matchResults
      .filter(r => r.status === 'missing')
      .map(r => r.query);
    
    if (missingItems.length === 0) {
      alert('没有失败项可复制');
      return;
    }
    
    const text = missingItems.join('\n');
    safeCopy(text, () => {
      // 临时改变按钮文本显示复制成功
      const originalText = btnCopyMissing.textContent;
      btnCopyMissing.textContent = '✅ 已复制';
      btnCopyMissing.classList.add('bg-emerald-100', 'text-emerald-700');
      
      setTimeout(() => {
        btnCopyMissing.textContent = originalText;
        btnCopyMissing.classList.remove('bg-emerald-100', 'text-emerald-700');
      }, 2000);
    });
  }

  // 复制失败项按钮点击事件
  btnCopyMissing.addEventListener('click', copyMissingItems);

  // 页面加载时初始化连接检测 - 单一事件监听器
  function initializeApp() {
    // 防御性编程：检查关键元素是否存在
    const requiredElements = [
      connectionStatusEl, statusTextEl, btnRetry,
      statusDetailsEl, usernameDisplayEl, connectionErrorHintEl,
      errorMessageEl, errorSuggestionEl, btnSearch
    ];
    
    const missingElements = requiredElements.filter(el => !el);
    if (missingElements.length > 0) {
      console.error('缺少必要的DOM元素:', missingElements);
      // 如果关键元素缺失，延迟重试
      setTimeout(initializeApp, 100);
      return;
    }
    
    // 所有元素都存在，开始初始化
    console.log('DOM加载完成，开始初始化连接检测');
    initConnectionCheck();
  }

  // 使用单一事件监听器
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
  } else {
    // DOM已经加载完成，直接执行
    setTimeout(initializeApp, 0);
  }
})();
