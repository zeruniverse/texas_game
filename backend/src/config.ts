import * as fs from 'fs';
import * as path from 'path';

interface RoomConfig {
  count: number;
  namePrefix: string;
}

interface GameSettings {
  maxPlayers: number;
  blinds: {
    smallBlind: number;
    bigBlind: number;
  };
}

interface Config {
  rooms: {
    offline: RoomConfig;
    online: RoomConfig;
  };
  gameSettings: GameSettings;
  resetPassword: string;
}

// 读取配置文件
function loadConfig(): Config {
  try {
    const configPath = path.join(__dirname, '../config.json');
    const configData = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configData);
    console.log('配置加载成功:', { ...config, resetPassword: '***' }); // 隐藏密码
    return config;
  } catch (error) {
    console.error('配置文件加载失败，使用默认配置:', error);
    // 返回默认配置
    return {
      rooms: {
        offline: {
          count: 6,
          namePrefix: "线下房间"
        },
        online: {
          count: 3,
          namePrefix: "线上房间"
        }
      },
      gameSettings: {
        maxPlayers: 20,
        blinds: {
          smallBlind: 5,
          bigBlind: 10
        }
      },
      resetPassword: "admin123"
    };
  }
}

// 导出配置
export const config = loadConfig(); 