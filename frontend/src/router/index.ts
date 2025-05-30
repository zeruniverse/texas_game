import { createRouter, createWebHashHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';
import Lobby from '../components/Lobby.vue';
import Room from '../components/Room.vue';

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'Lobby', component: Lobby },
  { path: '/room/:id', name: 'Room', component: Room, props: true }
];

const router = createRouter({
  history: createWebHashHistory(),
  routes
});

export default router;