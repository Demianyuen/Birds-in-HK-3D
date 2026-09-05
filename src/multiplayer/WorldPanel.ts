import type { BirdsInHkGame } from '../game/BirdsInHkGame';
import { WorldClient } from './WorldClient';
import type { ServerMessage } from './protocol';

export class WorldPanel {
  readonly element = document.createElement('details');
  private readonly status = document.createElement('p');
  private readonly players = document.createElement('div');
  private readonly log = document.createElement('ol');
  private readonly client: WorldClient;
  private readonly blocked = new Set<string>();
  private readonly input = document.createElement('input');
  private readonly send = document.createElement('button');

  constructor(private readonly game: BirdsInHkGame, endpoint: string | undefined) {
    this.element.className = 'world-panel';
    this.element.hidden = true;
    const title = document.createElement('summary');
    title.textContent = '一起飛行 · 線上與對話';
    const content = document.createElement('div');
    content.className = 'world-panel-content';
    this.element.append(title, content);
    this.status.setAttribute('role', 'status');
    const join = document.createElement('form');
    const name = document.createElement('input');
    name.placeholder = '暱稱（訪客）';
    name.setAttribute('aria-label', '玩家暱稱');
    name.maxLength = 24;
    name.required = true;
    const room = document.createElement('input');
    room.value = 'tai-po';
    room.setAttribute('aria-label', '房間');
    room.pattern = 'tai-po(-[a-z0-9]{1,16})?';
    room.required = true;
    const joinButton = document.createElement('button');
    joinButton.textContent = '加入／重新連線';
    const leave = document.createElement('button');
    leave.textContent = '離開連線';
    leave.type = 'button';
    const warning = document.createElement('p');
    warning.className = 'world-note';
    warning.textContent = '訪客暱稱非認證身份；短暫斷線可自動恢復（兩分鐘有效）。主動重新加入會回到起飛點。訊息不保存。';
    join.append(name, room, joinButton, leave);
    this.log.setAttribute('aria-label', '聊天訊息');
    this.log.setAttribute('role', 'log');
    const chat = document.createElement('form');
    this.input.maxLength = 280;
    this.input.required = true;
    this.input.placeholder = '向同伴打招呼…';
    this.input.setAttribute('aria-label', '聊天內容');
    const scope = document.createElement('select');
    scope.setAttribute('aria-label', '聊天範圍');
    for (const [value, text] of [['room', '房間'], ['nearby', '附近 150 米']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      scope.append(option);
    }
    this.send.textContent = '傳送';
    chat.append(scope, this.input, this.send);
    content.append(this.status, join, warning, this.players, this.log, chat);
    this.client = new WorldClient(message => this.receive(message), state => {
      this.status.textContent = state === 'online' ? '已連線' : state === 'connecting' ? '連線中…'
        : state === 'reconnecting' ? '連線中斷 · 正在嘗試恢復' : '離線 · 可重新加入';
      this.send.disabled = state !== 'online';
      if (state !== 'online') {
        game.syncPlayers([]);
        this.players.replaceChildren();
        delete this.players.dataset.signature;
      }
    });
    this.send.disabled = true;
    this.status.textContent = endpoint ? '多人主機已設定，填寫暱稱後加入。' : '多人主機尚未配置，目前為單人模式。';
    joinButton.disabled = !endpoint;
    join.addEventListener('submit', event => {
      event.preventDefault();
      if (!endpoint) return;
      try { this.client.connect(endpoint, name.value, room.value); }
      catch (error) { this.status.textContent = error instanceof Error ? error.message : '連線失敗。'; }
    });
    leave.addEventListener('click', () => this.client.disconnect());
    chat.addEventListener('submit', event => {
      event.preventDefault();
      if (this.client.chat(this.input.value, scope.value === 'nearby' ? 'nearby' : 'room')) this.input.value = '';
    });
    this.element.addEventListener('focusin', () => {
      game.clearControls();
      if (document.pointerLockElement) document.exitPointerLock();
    });
  }

  update(): void {
    const pose = this.game.getNetworkPose();
    this.client.pose(pose.position, pose.quaternion, pose.perched);
  }

  dispose(): void { this.client.disconnect(); this.element.remove(); }

  private receive(message: ServerMessage): void {
    if (message.type === 'welcome') {
      if (message.resumed && message.player) this.game.restoreSessionPose(message.player);
      else {
        this.game.resetFlight();
        this.log.replaceChildren();
        this.blocked.clear();
      }
    } else if (message.type === 'snapshot') {
      this.game.syncPlayers(this.client.peers);
      // Avoid rebuilding focused block buttons at the snapshot frequency.
      const signature = this.client.peers.map(player => `${player.id}:${player.name}`).join('|');
      if (this.players.dataset.signature === signature) return;
      this.players.dataset.signature = signature;
      this.players.replaceChildren();
      const count = document.createElement('p');
      count.textContent = `同房玩家：${message.players.length}`;
      this.players.append(count);
      const list = document.createElement('div');
      list.className = 'world-player-list';
      list.setAttribute('aria-label', '同房玩家名單');
      list.tabIndex = 0;
      this.players.append(list);
      for (const player of this.client.peers) {
        const button = document.createElement('button');
        const update = () => { button.textContent = `${player.name} · ${this.blocked.has(player.id) ? '解除靜音' : '靜音'}`; };
        button.type = 'button';
        update();
        button.addEventListener('click', () => {
          if (this.blocked.has(player.id)) this.blocked.delete(player.id);
          else this.blocked.add(player.id);
          update();
        });
        list.append(button);
      }
    } else if (message.type === 'chat' && !this.blocked.has(message.senderId)) {
      const item = document.createElement('li');
      // Never treat player-supplied names or messages as HTML.
      item.textContent = `${message.scope === 'nearby' ? '附近' : '房間'} · ${message.name}：${message.text}`;
      this.log.append(item);
      while (this.log.children.length > 60) this.log.firstElementChild?.remove();
      this.log.scrollTop = this.log.scrollHeight;
    } else if (message.type === 'error') {
      this.status.textContent = message.code === 'chat_rate_limited' ? '發言太快，請稍候一秒。'
        : message.code === 'room_full' ? '房間已滿，請選擇另一個房間。'
        : message.code === 'invalid_pose' ? '位置更新被拒絕；請重新加入以回到起飛點。'
        : '伺服器拒絕此操作，請檢查輸入或重新連線。';
    }
  }
}
