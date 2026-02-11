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

  // 格式化显示：歌名（绿色加粗） - 歌手（灰色小号） 【专辑名（灰色小号）】
  function formatSongDisplayHtml(song) {
    const title = escapeHtml((song.title || '').trim());
    const artist = escapeHtml((song.artist || '').trim());
    const album = escapeHtml((song.album || '').trim());
    const meta = album ? ` - <span class="song-meta">${artist}</span> <span class="song-meta">【${album}】</span>` : ` - <span class="song-meta">${artist}</span>`;
    return `<span class="song-title">${title}</span>${meta}`;
  }

  // 状态：匹配结果 [{ query, status, song? }]
  let matchResults = [];
  let selectedSongs = []; // 最终选中的歌曲（含多选时用户选的）

  // 开始匹配
  btnSearch.addEventListener('click', async () => {
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

    btnSearch.disabled = true;
    matchResults = [];
    selectedSongs = [];
    matchedListEl.innerHTML = '';
    missingListEl.innerHTML = '';
    progressTextEl.textContent = '';
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
            progressTextEl.textContent = `完成：匹配 ${selectedSongs.length} 首，缺失 ${matchResults.filter(r => r.status === 'missing').length} 首`;
            generateHintEl.classList.remove('hidden');
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
      btnSearch.disabled = false;
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
    li.className = 'text-red-600';
    li.textContent = query;
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
    progressTextEl.textContent = '';
    generateHintEl.classList.add('hidden');
    btnGenerate.disabled = true;
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
})();
