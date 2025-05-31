# 德州扑克房间配置说明

## 配置文件位置

配置文件位于 `backend/config.json`

## 配置项说明

### 房间配置 (rooms)

#### 线下房间 (offline)
- `count`: 线下房间数量，范围：0-50 (默认: 6)
- `namePrefix`: 线下房间名称前缀 (默认: "线下房间")

#### 线上房间 (online)  
- `count`: 线上房间数量，范围：0-50 (默认: 3)
- `namePrefix`: 线上房间名称前缀 (默认: "线上房间")

### 游戏设置 (gameSettings)
- `maxPlayers`: 每个房间最大玩家数，范围：2-50 (默认: 20)
- `blinds.smallBlind`: 小盲注，必须 > 0 (默认: 5)
- `blinds.bigBlind`: 大盲注，必须 > smallBlind (默认: 10)

### 安全设置
- `resetPassword`: 重置服务器密码，用于管理员重置服务器功能 (默认: "admin123")

## 房间命名规则

房间按以下规则命名：
- 线下房间：`{namePrefix}1`, `{namePrefix}2`, ...
- 线上房间：`{namePrefix}1`, `{namePrefix}2`, ...

房间ID按创建顺序分配：room1, room2, room3...（先线下房间，后线上房间）

## 配置示例

### 默认配置
```json
{
  "rooms": {
    "offline": {
      "count": 6,
      "namePrefix": "线下房间"
    },
    "online": {
      "count": 3,
      "namePrefix": "线上房间"
    }
  },
  "gameSettings": {
    "maxPlayers": 20,
    "blinds": {
      "smallBlind": 5,
      "bigBlind": 10
    }
  },
  "resetPassword": "admin123"
}
```

### 自定义配置示例
```json
{
  "rooms": {
    "offline": {
      "count": 10,
      "namePrefix": "线下桌"
    },
    "online": {
      "count": 5,
      "namePrefix": "线上桌"
    }
  },
  "gameSettings": {
    "maxPlayers": 25,
    "blinds": {
      "smallBlind": 10,
      "bigBlind": 20
    }
  },
  "resetPassword": "your_secure_password_here"
}
```

## 重置服务器功能

### 功能说明
- 管理员可以通过前端页面的"重置服务器"按钮强制重置所有房间
- 重置操作需要输入配置文件中设置的管理员密码
- 重置时会：
  1. 强制断开所有玩家连接
  2. 关闭所有房间线程
  3. 重新创建所有房间为初始状态

### 使用方法
1. 在房间列表页面点击红色的"重置服务器"按钮
2. 在弹出的对话框中输入管理员密码
3. 确认后服务器将执行重置操作

### 安全注意事项
- 请设置一个强密码作为重置密码
- 重置密码不会暴露给前端用户
- 建议定期更换重置密码

## 如何更新配置

1. 编辑 `backend/config.json` 文件
2. 保存文件
3. 重新启动后端服务器：`npm start`
4. 检查启动日志确认配置加载成功

## 启动日志示例

正常启动时会看到如下日志：
```
配置加载成功: { rooms: { offline: { count: 6, namePrefix: '线下房间' }, online: { count: 3, namePrefix: '线上房间' } }, gameSettings: { maxPlayers: 20, blinds: { smallBlind: 5, bigBlind: 10 } }, resetPassword: '***' }
已根据配置创建 6 个线下房间和 3 个线上房间
```

## 错误处理

- 如果配置文件不存在或格式错误，系统将使用默认配置
- 如果配置项不合法（如负数房间数量），系统可能使用默认值
- 建议使用 `config.example.json` 作为参考模板

## 注意事项

- 配置更改只有在重启服务器后才会生效
- 建议在修改配置前备份原配置文件
- 线下房间主要用于实体扑克游戏，线上房间用于纯数字游戏
- 房间数量为0是有效配置，表示不创建该类型房间
- 重置密码应该保密，不要设置过于简单的密码 