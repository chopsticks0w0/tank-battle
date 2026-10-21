/* ============================================================
   坦克大战（Battle Tank）
   原生 HTML / CSS / JavaScript 实现，无任何第三方依赖。

   实现要点：
     - 网格地图 + 砖墙（可摧毁）/ 钢墙（不可摧毁）/ 基地
     - 玩家坦克（方向键 / WASD 移动，空格 / J 射击）
     - 敌方坦克（AI 自动寻路与射击，分波次刷新）
     - 移动、射击、碰撞检测、生命值、胜负判断、重新开始
   ============================================================ */

(() => {
  'use strict';

  /* ----------------------------------------------------------
     一、常量配置
     ---------------------------------------------------------- */

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');

  const COLS = 26;          // 地图列数
  const ROWS = 26;          // 地图行数
  const CELL = 24;          // 每个格子的像素大小
  canvas.width = COLS * CELL;   // 624
  canvas.height = ROWS * CELL;  // 624

  // 格子类型
  const TILE = {
    EMPTY: 0,   // 空地
    BRICK: 1,   // 砖墙（可被子弹摧毁）
    STEEL: 2,   // 钢墙（不可摧毁）
    BASE: 3,    // 基地（被摧毁即失败）
  };

  // 方向向量（x 为列方向，y 为行方向）
  const DIR = {
    UP:    { x: 0,  y: -1 },
    DOWN:  { x: 0,  y: 1  },
    LEFT:  { x: -1, y: 0  },
    RIGHT: { x: 1,  y: 0  },
  };

  // 游戏参数
  const START_LIVES = 3;          // 玩家初始生命数
  const TOTAL_ENEMIES = 8;        // 本局敌人总数
  const MAX_ALIVE_ENEMIES = 4;    // 同时在场的最多敌人数量
  const SPAWN_INTERVAL = 2500;    // 敌人刷新的时间间隔（毫秒）
  const ENEMY_AI_TICK = 500;      // 敌人 AI 决策的基础间隔（毫秒）
  const ENEMY_FIRE_CHANCE = 0.22; // 敌人每次决策时开火的概率
  const MOVE_DURATION_PLAYER = 130; // 玩家移动一格所需时间（毫秒）
  const MOVE_DURATION_ENEMY = 220;  // 敌人移动一格所需时间（毫秒）
  const BULLET_SPEED = 320;         // 子弹速度（像素/秒）
  const FIRE_COOLDOWN = 320;        // 开火冷却（毫秒）
  const MAX_BULLETS_PER_TANK = 2;   // 每辆坦克同时在场的子弹数上限

  /* ----------------------------------------------------------
     二、地图
     地图采用「先全空、再填充障碍块」的方式生成，避免手写字符串出错。
     ---------------------------------------------------------- */

  let map = []; // map[row][col]

  // 用指定类型填充一个矩形区域
  function fillBlock(c, r, w, h, type) {
    for (let rr = r; rr < r + h; rr++) {
      for (let cc = c; cc < c + w; cc++) {
        if (cc >= 0 && cc < COLS && rr >= 0 && rr < ROWS) {
          map[rr][cc] = type;
        }
      }
    }
  }

  // 构建地图
  function buildMap() {
    map = Array.from({ length: ROWS }, () => Array(COLS).fill(TILE.EMPTY));

    // 钢墙（不可摧毁）：[列, 行, 宽, 高]
    const steelBlocks = [
      [4, 8, 2, 2],
      [20, 8, 2, 2],
    ];

    // 砖墙（可摧毁）：[列, 行, 宽, 高]
    const brickBlocks = [
      // 顶部零散砖块
      [2, 2, 1, 1], [5, 2, 1, 1], [8, 2, 1, 1], [11, 2, 1, 1],
      [14, 2, 1, 1], [17, 2, 1, 1], [20, 2, 1, 1], [23, 2, 1, 1],
      // 中上部砖墙阵列
      [2, 4, 2, 2], [6, 4, 2, 2], [10, 4, 2, 2],
      [14, 4, 2, 2], [18, 4, 2, 2], [22, 4, 2, 2],
      [8, 8, 2, 2], [16, 8, 2, 2],
      [2, 10, 2, 2], [10, 10, 2, 2], [14, 10, 2, 2], [22, 10, 2, 2],
      // 中央砖块
      [12, 12, 2, 2],
      // 中下部砖墙阵列
      [6, 14, 2, 2], [18, 14, 2, 2],
      [2, 17, 2, 2], [22, 17, 2, 2],
      [6, 19, 2, 2], [18, 19, 2, 2],
      // 保护基地的围墙（顶部 + 左右两侧）
      [11, 23, 4, 1],
      [11, 24, 1, 2],
      [14, 24, 1, 2],
    ];

    for (const [c, r, w, h] of steelBlocks) fillBlock(c, r, w, h, TILE.STEEL);
    for (const [c, r, w, h] of brickBlocks) fillBlock(c, r, w, h, TILE.BRICK);

    // 基地（2x2，位于底部中央）
    fillBlock(12, 24, 2, 2, TILE.BASE);
  }

  /* ----------------------------------------------------------
     三、通用工具函数
     ---------------------------------------------------------- */

  // 方向 → 弧度（用于绘制炮管朝向）
  function dirAngle(dir) {
    if (dir === DIR.UP) return -Math.PI / 2;
    if (dir === DIR.DOWN) return Math.PI / 2;
    if (dir === DIR.LEFT) return Math.PI;
    return 0; // 默认向右
  }

  // 矩形重叠检测（AABB）
  function rectOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  // 洗牌（返回新数组）
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ----------------------------------------------------------
     四、坦克类
     坦克按网格逐格移动：静止时位于某个格子，移动时在相邻两格之间插值动画。
     ---------------------------------------------------------- */

  class Tank {
    constructor(col, row, dir, isPlayer) {
      this.col = col;                 // 当前所在列（静止时）
      this.row = row;                 // 当前所在行（静止时）
      this.dir = dir;                 // 当前朝向
      this.isPlayer = isPlayer;       // 是否为玩家坦克

      // 移动动画相关
      this.fromCol = col;
      this.fromRow = row;
      this.toCol = col;
      this.toRow = row;
      this.moving = false;            // 是否正在移动
      this.progress = 1;              // 移动进度 0..1，1 表示已就位

      // 战斗状态
      this.moveDuration = isPlayer ? MOVE_DURATION_PLAYER : MOVE_DURATION_ENEMY;
      this.bulletCooldown = 0;        // 开火冷却剩余时间（毫秒）
      this.invulnerable = 0;          // 无敌剩余时间（毫秒，重生/出生保护）
      this.alive = true;              // 是否存活
      this.aiTimer = ENEMY_AI_TICK;   // 敌人 AI 决策计时器
    }

    // 当前像素 X 坐标（移动中会进行插值）
    get x() {
      const c = this.moving
        ? this.fromCol + (this.toCol - this.fromCol) * this.progress
        : this.col;
      return c * CELL;
    }

    // 当前像素 Y 坐标
    get y() {
      const r = this.moving
        ? this.fromRow + (this.toRow - this.fromRow) * this.progress
        : this.row;
      return r * CELL;
    }

    // 尝试朝某方向移动一格；返回是否成功（移动中 / 被阻挡返回 false）
    tryMove(dir) {
      if (!this.alive || this.moving) return false;
      this.dir = dir; // 先转向（即使被阻挡也允许原地转向）
      const nc = this.col + dir.x;
      const nr = this.row + dir.y;
      if (!isPassable(nc, nr, this)) return false;

      this.fromCol = this.col;
      this.fromRow = this.row;
      this.toCol = nc;
      this.toRow = nr;
      this.moving = true;
      this.progress = 0;
      return true;
    }

    // 每帧推进动画与冷却
    update(dt) {
      if (this.moving) {
        this.progress += dt / this.moveDuration;
        if (this.progress >= 1) {
          this.progress = 1;
          this.col = this.toCol;
          this.row = this.toRow;
          this.moving = false;
        }
      }
      if (this.bulletCooldown > 0) this.bulletCooldown -= dt;
      if (this.invulnerable > 0) this.invulnerable -= dt;
    }
  }

  /* ----------------------------------------------------------
     五、子弹类
     子弹使用连续像素坐标移动，逐帧检测与坦克、地形的碰撞。
     ---------------------------------------------------------- */

  class Bullet {
    constructor(x, y, dir, owner) {
      this.x = x;
      this.y = y;
      this.dir = dir;
      this.owner = owner; // 发射者坦克（用于同阵营免疫）
      this.size = 6;      // 子弹边长（像素）
      this.active = true;
    }

    update(dt) {
      this.x += this.dir.x * BULLET_SPEED * (dt / 1000);
      this.y += this.dir.y * BULLET_SPEED * (dt / 1000);

      // 飞出边界即消失
      if (
        this.x < -this.size || this.x > canvas.width ||
        this.y < -this.size || this.y > canvas.height
      ) {
        this.active = false;
        return;
      }

      handleBulletCollisions(this);
    }
  }

  /* ----------------------------------------------------------
     六、游戏状态
     ---------------------------------------------------------- */

  let tanks = [];        // 所有坦克（含玩家与敌人）
  let bullets = [];      // 所有子弹
  let effects = [];      // 爆炸特效
  let player = null;     // 玩家坦克引用

  let score = 0;
  let lives = START_LIVES;
  let enemiesToSpawn = 0; // 尚未刷新的敌人数量
  let enemiesAlive = 0;   // 当前存活的敌人数量
  let spawnTimer = 0;     // 敌人刷新计时器
  let state = 'idle';     // idle | playing | win | lose

  // 玩家出生点（含备用点，避免被占用时无法重生）
  const PLAYER_SPAWNS = [
    [12, 22], [11, 22], [13, 22], [12, 21],
  ];

  /* ----------------------------------------------------------
     七、输入处理
     ---------------------------------------------------------- */

  const keys = {}; // 当前按住的按键集合

  // 需要阻止默认行为的按键（避免方向键 / 空格滚动页面）
  const PREVENT_KEYS = new Set([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

  window.addEventListener('keydown', (e) => {
    const k = (e.key || '').toLowerCase();
    if (PREVENT_KEYS.has(k)) e.preventDefault();
    keys[k] = true;
    if (k === 'r') resetGame(); // R 键随时重新开始
  });

  window.addEventListener('keyup', (e) => {
    const k = (e.key || '').toLowerCase();
    keys[k] = false;
  });

  /* ----------------------------------------------------------
     八、碰撞与战斗逻辑
     ---------------------------------------------------------- */

  // 判断某个格子是否可通行（空地，且无其它坦克占用）
  function isPassable(col, row, self) {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return false;
    if (map[row][col] !== TILE.EMPTY) return false;
    for (const t of tanks) {
      if (t === self || !t.alive) continue;
      // 其它坦克当前所在格或正在前往的格子
      if ((t.col === col && t.row === row) ||
          (t.moving && t.toCol === col && t.toRow === row)) {
        return false;
      }
    }
    return true;
  }

  // 发射子弹（受冷却时间与场上子弹数量限制）
  function fire(tank) {
    if (!tank.alive || tank.bulletCooldown > 0) return;

    const myBullets = bullets.filter((b) => b.owner === tank && b.active);
    if (myBullets.length >= MAX_BULLETS_PER_TANK) return;

    const cx = tank.x + CELL / 2;
    const cy = tank.y + CELL / 2;
    const offset = CELL / 2 + 4; // 从炮口前方生成，避免立刻击中自己
    const bx = cx + tank.dir.x * offset;
    const by = cy + tank.dir.y * offset;

    bullets.push(new Bullet(bx - 3, by - 3, tank.dir, tank));
    tank.bulletCooldown = FIRE_COOLDOWN;
  }

  // 处理子弹碰撞：先检测坦克，再检测地形
  function handleBulletCollisions(b) {
    // 1) 与坦克碰撞（同阵营免疫）
    for (const t of tanks) {
      if (!t.alive || t.isPlayer === b.owner.isPlayer) continue;
      if (rectOverlap(b.x, b.y, b.size, b.size, t.x, t.y, CELL, CELL)) {
        b.active = false;
        hitTank(t);
        return;
      }
    }

    // 2) 与地形碰撞
    const cx = Math.floor((b.x + b.size / 2) / CELL);
    const cy = Math.floor((b.y + b.size / 2) / CELL);
    if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) {
      b.active = false;
      return;
    }

    const tile = map[cy][cx];
    if (tile === TILE.BRICK) {
      map[cy][cx] = TILE.EMPTY; // 砖墙被摧毁
      b.active = false;
    } else if (tile === TILE.STEEL) {
      b.active = false; // 钢墙不可摧毁，子弹消失
    } else if (tile === TILE.BASE) {
      b.active = false;
      baseDestroyed(); // 基地被摧毁，直接失败
    }
  }

  // 坦克被击中
  function hitTank(t) {
    if (t.invulnerable > 0) return; // 无敌期间不受伤害

    t.alive = false;
    spawnExplosion(t.x + CELL / 2, t.y + CELL / 2);

    if (t.isPlayer) {
      lives--;
      updateHUD();
      if (lives <= 0) {
        gameOver(false, '生命耗尽，任务失败。');
      } else {
        respawnPlayer(); // 还有生命则重生
      }
    } else {
      enemiesAlive--;
      score += 100;
      updateHUD();
      // 所有敌人被消灭 → 胜利
      if (enemiesAlive === 0 && enemiesToSpawn === 0) {
        gameOver(true, '恭喜！你消灭了所有敌人，最终得分 ' + score + '。');
      }
    }
  }

  // 基地被摧毁
  function baseDestroyed() {
    fillBlock(12, 24, 2, 2, TILE.EMPTY); // 清空基地格子
    gameOver(false, '基地被摧毁，游戏失败。');
  }

  // 生成爆炸特效
  function spawnExplosion(x, y) {
    effects.push({ x, y, age: 0, duration: 300 });
  }

  /* ----------------------------------------------------------
     九、玩家重生与敌人刷新
     ---------------------------------------------------------- */

  // 寻找空闲出生点
  function findFreeSpawn() {
    for (const [c, r] of PLAYER_SPAWNS) {
      if (isPassable(c, r, null)) return { c, r };
    }
    return null;
  }

  // 玩家重生：回到出生点，短暂无敌
  function respawnPlayer() {
    const spot = findFreeSpawn() || { c: 12, r: 22 };
    player.col = spot.c;
    player.row = spot.r;
    player.fromCol = spot.c;
    player.fromRow = spot.r;
    player.toCol = spot.c;
    player.toRow = spot.r;
    player.moving = false;
    player.progress = 1;
    player.dir = DIR.UP;
    player.bulletCooldown = 0;
    player.invulnerable = 2000;
    player.alive = true;
  }

  // 刷新一个敌人（从顶部三个出生点中选择空闲位置）
  function spawnEnemy() {
    if (enemiesToSpawn <= 0 || enemiesAlive >= MAX_ALIVE_ENEMIES) return;

    const spawnPoints = [{ c: 0, r: 0 }, { c: 12, r: 0 }, { c: 25, r: 0 }];
    for (const p of spawnPoints) {
      if (isPassable(p.c, p.r, null)) {
        const e = new Tank(p.c, p.r, DIR.DOWN, false);
        e.invulnerable = 1200; // 出生短暂无敌，避免被瞬间击杀
        e.aiTimer = 500 + Math.random() * 600;
        tanks.push(e);
        enemiesToSpawn--;
        enemiesAlive++;
        updateHUD();
        return;
      }
    }
  }

  // 敌人刷新调度
  function updateSpawner(dt) {
    if (enemiesToSpawn <= 0) return;
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnEnemy();
      spawnTimer = SPAWN_INTERVAL;
    }
  }

  /* ----------------------------------------------------------
     十、每帧更新
     ---------------------------------------------------------- */

  // 玩家输入
  function updatePlayer() {
    if (!player.alive) return;

    let wantDir = null;
    if (keys['arrowup'] || keys['w']) wantDir = DIR.UP;
    else if (keys['arrowdown'] || keys['s']) wantDir = DIR.DOWN;
    else if (keys['arrowleft'] || keys['a']) wantDir = DIR.LEFT;
    else if (keys['arrowright'] || keys['d']) wantDir = DIR.RIGHT;

    if (wantDir) player.tryMove(wantDir);

    // 空格 / J / 回车 开火
    if (keys[' '] || keys['j'] || keys['enter']) {
      fire(player);
    }
  }

  // 敌人 AI：随机决策移动或开火
  function updateEnemy(t, dt) {
    if (!t.alive || t.moving) return;

    t.aiTimer -= dt;
    if (t.aiTimer > 0) return;
    t.aiTimer = ENEMY_AI_TICK + Math.random() * ENEMY_AI_TICK;

    // 有一定概率开火
    if (Math.random() < ENEMY_FIRE_CHANCE) {
      fire(t);
      return;
    }

    // 尝试朝当前方向移动；被阻挡则随机选择一个可通行方向
    if (!t.tryMove(t.dir)) {
      const dirs = shuffle([DIR.UP, DIR.DOWN, DIR.LEFT, DIR.RIGHT]);
      let moved = false;
      for (const d of dirs) {
        if (t.tryMove(d)) {
          moved = true;
          break;
        }
      }
      if (!moved) t.dir = dirs[0]; // 完全被困时仅调整朝向待命
    }
  }

  // 更新所有子弹
  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      bullets[i].update(dt);
      if (!bullets[i].active) bullets.splice(i, 1);
    }
  }

  // 更新爆炸特效
  function updateEffects(dt) {
    for (let i = effects.length - 1; i >= 0; i--) {
      effects[i].age += dt;
      if (effects[i].age >= effects[i].duration) effects.splice(i, 1);
    }
  }

  // 主更新
  function update(dt) {
    updateSpawner(dt);

    // 先推进动画与敌人 AI
    for (const t of tanks) {
      t.update(dt);
      if (!t.isPlayer) updateEnemy(t, dt);
    }

    // 再处理玩家输入
    updatePlayer();

    updateBullets(dt);
    updateEffects(dt);
  }

  /* ----------------------------------------------------------
     十一、渲染
     ---------------------------------------------------------- */

  // 绘制地图瓦片
  function drawTiles() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = map[r][c];
        if (t === TILE.EMPTY) continue;
        const x = c * CELL;
        const y = r * CELL;

        if (t === TILE.BRICK) {
          // 砖墙：橙色底 + 砖缝
          ctx.fillStyle = '#b5651d';
          ctx.fillRect(x, y, CELL, CELL);
          ctx.strokeStyle = '#8a4a12';
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
          ctx.beginPath();
          ctx.moveTo(x, y + CELL / 2);
          ctx.lineTo(x + CELL, y + CELL / 2);
          ctx.moveTo(x + CELL / 2, y);
          ctx.lineTo(x + CELL / 2, y + CELL / 2);
          ctx.moveTo(x + CELL / 4, y + CELL / 2);
          ctx.lineTo(x + CELL / 4, y + CELL);
          ctx.moveTo(x + (CELL * 3) / 4, y + CELL / 2);
          ctx.lineTo(x + (CELL * 3) / 4, y + CELL);
          ctx.stroke();
        } else if (t === TILE.STEEL) {
          // 钢墙：灰底 + 高光块
          ctx.fillStyle = '#7f8c8d';
          ctx.fillRect(x, y, CELL, CELL);
          ctx.strokeStyle = '#5d6d6e';
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
          ctx.fillStyle = '#d5d8dc';
          ctx.fillRect(x + 4, y + 4, CELL - 8, CELL - 8);
        } else if (t === TILE.BASE) {
          // 基地：深色底 + 旗帜图标
          ctx.fillStyle = '#34495e';
          ctx.fillRect(x, y, CELL, CELL);
          drawFlag(x, y);
        }
      }
    }
  }

  // 绘制基地旗帜图标
  function drawFlag(x, y) {
    // 底座
    ctx.fillStyle = '#e67e22';
    ctx.fillRect(x + 2, y + CELL - 6, CELL - 4, 4);
    // 旗杆
    ctx.fillStyle = '#ecf0f1';
    ctx.fillRect(x + CELL / 2 - 1, y + 2, 2, CELL - 6);
    // 旗帜
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.moveTo(x + CELL / 2 + 1, y + 2);
    ctx.lineTo(x + CELL - 2, y + 6);
    ctx.lineTo(x + CELL / 2 + 1, y + 10);
    ctx.closePath();
    ctx.fill();
  }

  // 绘制坦克
  function drawTank(t) {
    // 无敌期间闪烁
    if (t.invulnerable > 0 && Math.floor(performance.now() / 120) % 2 === 0) {
      return;
    }

    const x = t.x;
    const y = t.y;
    const bodyColor = t.isPlayer ? '#6aa84f' : '#c0392b'; // 玩家绿 / 敌人红
    const darkColor = t.isPlayer ? '#3e6b2a' : '#8e2c20';
    const turretColor = t.isPlayer ? '#8bc34a' : '#e74c3c';

    // 履带（底层）
    ctx.fillStyle = darkColor;
    ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
    // 车体
    ctx.fillStyle = bodyColor;
    ctx.fillRect(x + 4, y + 4, CELL - 8, CELL - 8);
    // 炮塔
    ctx.fillStyle = turretColor;
    ctx.beginPath();
    ctx.arc(x + CELL / 2, y + CELL / 2, CELL / 3, 0, Math.PI * 2);
    ctx.fill();
    // 炮管
    ctx.fillStyle = darkColor;
    ctx.save();
    ctx.translate(x + CELL / 2, y + CELL / 2);
    ctx.rotate(dirAngle(t.dir));
    ctx.fillRect(0, -3, CELL / 2 + 3, 6);
    ctx.restore();
  }

  // 绘制子弹
  function drawBullets() {
    for (const b of bullets) {
      if (!b.active) continue;
      ctx.fillStyle = b.owner.isPlayer ? '#ffe066' : '#f8f9fa';
      ctx.fillRect(b.x, b.y, b.size, b.size);
    }
  }

  // 绘制爆炸特效
  function drawEffects() {
    for (const e of effects) {
      const p = e.age / e.duration;
      const r = 4 + p * 12;
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = '#f39c12';
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // 主渲染
  function render() {
    ctx.fillStyle = '#10101a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawTiles();
    drawEffects();

    for (const t of tanks) {
      if (t.alive) drawTank(t);
    }

    drawBullets();
  }

  /* ----------------------------------------------------------
     十二、HUD 与胜负界面
     ---------------------------------------------------------- */

  const livesEl = document.getElementById('lives');
  const scoreEl = document.getElementById('score');
  const enemiesEl = document.getElementById('enemies');
  const overlayEl = document.getElementById('overlay');
  const overlayTitleEl = document.getElementById('overlayTitle');
  const overlayMsgEl = document.getElementById('overlayMsg');
  const restartBtn = document.getElementById('restartBtn');

  function updateHUD() {
    livesEl.textContent = '♥'.repeat(Math.max(0, lives));
    scoreEl.textContent = score;
    enemiesEl.textContent = enemiesToSpawn + enemiesAlive;
  }

  function showOverlay(title, msg) {
    overlayTitleEl.textContent = title;
    overlayMsgEl.textContent = msg;
    overlayEl.classList.remove('hidden');
  }

  function hideOverlay() {
    overlayEl.classList.add('hidden');
  }

  // 胜负判断
  function gameOver(win, msg) {
    if (state !== 'playing') return;
    state = win ? 'win' : 'lose';
    showOverlay(win ? '🎉 胜利！' : '💥 游戏结束', msg);
  }

  /* ----------------------------------------------------------
     十三、重新开始
     ---------------------------------------------------------- */

  function resetGame() {
    buildMap();
    tanks = [];
    bullets = [];
    effects = [];
    score = 0;
    lives = START_LIVES;
    enemiesToSpawn = TOTAL_ENEMIES;
    enemiesAlive = 0;
    spawnTimer = 600;
    state = 'playing';

    // 清空按住状态，避免开局误触发
    for (const k in keys) keys[k] = false;

    player = new Tank(12, 22, DIR.UP, true);
    tanks.push(player);

    hideOverlay();
    updateHUD();
  }

  restartBtn.addEventListener('click', resetGame);

  /* ----------------------------------------------------------
     十四、主循环
     ---------------------------------------------------------- */

  let lastTime = 0;

  function loop(timestamp) {
    // 限制单帧最大步长，避免切后台后跳帧导致穿墙
    const dt = Math.min(timestamp - lastTime, 100);
    lastTime = timestamp;

    if (state === 'playing') update(dt);
    render();

    requestAnimationFrame(loop);
  }

  // 启动游戏
  resetGame();
  requestAnimationFrame(loop);

  // ---- 仅供自动化测试使用的调试句柄 ----
  // 浏览器中 `module` 未定义，此分支不会执行，对游戏运行无任何影响。
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      _t: {
        DIR,
        Tank,
        Bullet,
        get map() { return map; },
        get tanks() { return tanks; },
        get bullets() { return bullets; },
        get player() { return player; },
        get state() { return state; },
        get score() { return score; },
        get lives() { return lives; },
        get enemiesAlive() { return enemiesAlive; },
        get enemiesToSpawn() { return enemiesToSpawn; },
        set enemiesAlive(v) { enemiesAlive = v; },
        set enemiesToSpawn(v) { enemiesToSpawn = v; },
        set lives(v) { lives = v; },
        resetGame, update, fire, hitTank, respawnPlayer, baseDestroyed, gameOver, spawnEnemy,
      },
    };
  }
})();
