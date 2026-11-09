const QUEST_DEFINITIONS = Object.freeze([
  {
    id: 'first-journey', category: 'main', title: 'Lời dặn của Lão Tu Sĩ', giver: 'Lão Tu Sĩ',
    location: 'Bình Nguyên Hoang Dã', summary: 'Rèn luyện bước đầu để chuẩn bị rời Thanh Vân Trấn.',
    objective: 'Đánh bại yêu thú', target: 3, initialStatus: 'active', initialProgress: 0,
    eventType: 'monster_kill', rewards: [
      { type: 'xu', amount: 50, icon: 'icon-coins', label: '50 Xu' },
      { type: 'tuVi', amount: 120, icon: 'icon-lotus', label: '120 Tu Vi' },
    ],
  },
  {
    id: 'plain-training', category: 'side', title: 'Thử sức ở Bình Nguyên', giver: 'Lão Tu Sĩ',
    location: 'Bình Nguyên Hoang Dã', summary: 'Rèn luyện kỹ năng chiến đấu trước khi tiến sâu vào vùng hoang dã.',
    objective: 'Đánh bại yêu thú', target: 5, initialStatus: 'available', initialProgress: 0,
    eventType: 'monster_kill', rewards: [
      { type: 'xu', amount: 80, icon: 'icon-coins', label: '80 Xu' },
      { type: 'item', itemId: 'STONE_LINH_NHO', amount: 1, icon: 'icon-talisman', label: '1 Linh Thạch Nhỏ' },
    ],
  },
  {
    id: 'spirit-stones', category: 'daily', title: 'Cơ duyên linh thạch', giver: 'Chủ Tiệm',
    location: 'Bình Nguyên Hoang Dã', summary: 'Thu thập chiến lợi phẩm rơi trên đường để đổi lấy tài nguyên tu luyện.',
    objective: 'Nhặt linh thạch nhỏ', target: 3, initialStatus: 'available', initialProgress: 0,
    eventType: 'collect_item', targetItemId: 'STONE_LINH_NHO', rewards: [
      { type: 'xu', amount: 60, icon: 'icon-coins', label: '60 Xu' },
      { type: 'item', itemId: 'HUYET_NGOC_NHO', amount: 2, icon: 'icon-potion-hp', label: '2 Huyết Ngọc Nhỏ' },
    ],
  },
  {
    id: 'novice-02-plain-wolves', category: 'main', title: 'Dấu chân Bình Nguyên', giver: 'Vệ Sĩ Tiền Trạm',
    location: 'Bình Nguyên Hoang Dã', summary: 'Qua cổng phía đông, rèn luyện giữa đồng hoang trước khi tiến sâu hơn.',
    objective: 'Đánh bại Hoang Sói', target: 5, initialStatus: 'available', initialProgress: 0,
    eventType: 'monster_kill', targetMonsterId: 'HOANG_SOI', targetMapCode: 'binh_nguyen', requiresQuestId: 'first-journey',
    rewards: [{ type: 'xu', amount: 80, icon: 'icon-coins', label: '80 Xu' }, { type: 'tuVi', amount: 100, icon: 'icon-lotus', label: '100 Tu Vi' }],
  },
  {
    id: 'novice-03-spirit-stones', category: 'main', title: 'Linh Thạch Đầu Tiên', giver: 'Vệ Sĩ Tiền Trạm',
    location: 'Bình Nguyên Hoang Dã', summary: 'Nhặt linh thạch do yêu thú đánh rơi để chuẩn bị vào rừng.',
    objective: 'Thu thập Linh Thạch Nhỏ', target: 3, initialStatus: 'available', initialProgress: 0,
    eventType: 'collect_item', targetItemId: 'STONE_LINH_NHO', targetMapCode: 'binh_nguyen', requiresQuestId: 'novice-02-plain-wolves',
    rewards: [{ type: 'xu', amount: 60, icon: 'icon-coins', label: '60 Xu' }, { type: 'tuVi', amount: 90, icon: 'icon-lotus', label: '90 Tu Vi' }],
  },
  {
    id: 'novice-04-enter-forest', category: 'main', title: 'Lối vào Rừng Rậm', giver: 'Vệ Sĩ Tiền Trạm',
    location: 'Rừng Rậm Thanh Vân', summary: 'Theo lối mòn ở Bình Nguyên để bước vào khu rừng phía trước.',
    objective: 'Tiến vào Rừng Rậm Thanh Vân', target: 1, initialStatus: 'available', initialProgress: 0,
    eventType: 'map_enter', targetMapCode: 'thanh_van_ngoai_vuc', requiresQuestId: 'novice-03-spirit-stones',
    rewards: [{ type: 'xu', amount: 50, icon: 'icon-coins', label: '50 Xu' }, { type: 'tuVi', amount: 100, icon: 'icon-lotus', label: '100 Tu Vi' }],
  },
  {
    id: 'novice-05-forest-hunt', category: 'main', title: 'Dọn lối rừng', giver: 'Lâm Tuần Sứ Trình Phong',
    location: 'Rừng Rậm Thanh Vân', summary: 'Độc Thảo Yêu đang chiếm lối hái thuốc; dọn sạch chúng để an toàn thu thập.',
    objective: 'Đánh bại Độc Thảo Yêu trong rừng', target: 4, initialStatus: 'available', initialProgress: 0,
    eventType: 'monster_kill', targetMonsterId: 'DOC_THAO', targetMapCode: 'thanh_van_ngoai_vuc', requiresQuestId: 'novice-04-enter-forest',
    rewards: [{ type: 'xu', amount: 90, icon: 'icon-coins', label: '90 Xu' }, { type: 'tuVi', amount: 140, icon: 'icon-lotus', label: '140 Tu Vi' }],
  },
  {
    id: 'novice-06-forest-herbs', category: 'main', title: 'Bạch Linh Thảo trong rừng', giver: 'Lâm Tuần Sứ Trình Phong',
    location: 'Rừng Rậm Thanh Vân', summary: 'Độc Thảo Yêu rơi ra linh thảo. Hái đủ rồi quay lại đường mòn.',
    objective: 'Thu thập Bạch Linh Thảo', target: 5, initialStatus: 'available', initialProgress: 0,
    eventType: 'collect_item', targetItemId: 'MAT_THAO_DUOC', targetMapCode: 'thanh_van_ngoai_vuc', requiresQuestId: 'novice-05-forest-hunt',
    rewards: [{ type: 'xu', amount: 100, icon: 'icon-coins', label: '100 Xu' }, { type: 'tuVi', amount: 160, icon: 'icon-lotus', label: '160 Tu Vi' }],
  },
  {
    id: 'novice-07-enter-valley', category: 'main', title: 'Đường xuống Sơn Cốc', giver: 'Lâm Tuần Sứ Trình Phong',
    location: 'Sơn Cốc Thanh Vân', summary: 'Qua cổng phía đông của rừng, tiến xuống thung lũng Thanh Vân.',
    objective: 'Tiến vào Sơn Cốc Thanh Vân', target: 1, initialStatus: 'available', initialProgress: 0,
    eventType: 'map_enter', targetMapCode: 'thanh_van_son_coc', requiresQuestId: 'novice-06-forest-herbs',
    rewards: [{ type: 'xu', amount: 70, icon: 'icon-coins', label: '70 Xu' }, { type: 'tuVi', amount: 120, icon: 'icon-lotus', label: '120 Tu Vi' }],
  },
  {
    id: 'novice-08-valley-hunt', category: 'main', title: 'Yêu thảo trong thung lũng', giver: 'Tu Sĩ Ẩn Cư',
    location: 'Sơn Cốc Thanh Vân', summary: 'Độc Thảo Yêu mọc quanh lòng sơn cốc. Hãy hạ chúng trước khi hái thuốc.',
    objective: 'Đánh bại Độc Thảo Yêu trong sơn cốc', target: 5, initialStatus: 'available', initialProgress: 0,
    eventType: 'monster_kill', targetMonsterId: 'DOC_THAO', targetMapCode: 'thanh_van_son_coc', requiresQuestId: 'novice-07-enter-valley',
    rewards: [{ type: 'xu', amount: 120, icon: 'icon-coins', label: '120 Xu' }, { type: 'tuVi', amount: 180, icon: 'icon-lotus', label: '180 Tu Vi' }],
  },
  {
    id: 'novice-09-valley-herbs', category: 'main', title: 'Linh thảo sơn cốc', giver: 'Tu Sĩ Ẩn Cư',
    location: 'Sơn Cốc Thanh Vân', summary: 'Thu thập linh thảo trong thung lũng để chuẩn bị đối đầu yêu thú mạnh hơn.',
    objective: 'Thu thập Bạch Linh Thảo', target: 8, initialStatus: 'available', initialProgress: 0,
    eventType: 'collect_item', targetItemId: 'MAT_THAO_DUOC', targetMapCode: 'thanh_van_son_coc', requiresQuestId: 'novice-08-valley-hunt',
    rewards: [{ type: 'xu', amount: 130, icon: 'icon-coins', label: '130 Xu' }, { type: 'tuVi', amount: 200, icon: 'icon-lotus', label: '200 Tu Vi' }],
  },
  {
    id: 'novice-10-xich-luyen-ho', category: 'main', title: 'Dấu vết Xích Luyện Hổ', giver: 'Tu Sĩ Ẩn Cư',
    location: 'Sơn Cốc Thanh Vân', summary: 'Hổ yêu tuần tra ở phía đông sơn cốc. Đừng áp sát khi chưa đủ sinh lực.',
    objective: 'Đánh bại Xích Luyện Hổ', target: 3, initialStatus: 'available', initialProgress: 0,
    eventType: 'monster_kill', targetMonsterId: 'XICH_LUYEN_HO', targetMapCode: 'thanh_van_son_coc', requiresQuestId: 'novice-09-valley-herbs',
    rewards: [{ type: 'xu', amount: 180, icon: 'icon-coins', label: '180 Xu' }, { type: 'tuVi', amount: 240, icon: 'icon-lotus', label: '240 Tu Vi' }],
  },
  {
    id: 'novice-11-boss-preparation', category: 'main', title: 'Thảo dược trước cửa ải', giver: 'Tu Sĩ Ẩn Cư',
    location: 'Sơn Cốc Thanh Vân', summary: 'Dự trữ linh thảo hồi phục trước khi khiêu chiến trấn quan ở cổng Bạch Vân Sơn.',
    objective: 'Thu thập Bạch Linh Thảo', target: 6, initialStatus: 'available', initialProgress: 0,
    eventType: 'collect_item', targetItemId: 'MAT_THAO_DUOC', targetMapCode: 'thanh_van_son_coc', requiresQuestId: 'novice-10-xich-luyen-ho',
    rewards: [{ type: 'xu', amount: 200, icon: 'icon-coins', label: '200 Xu' }, { type: 'tuVi', amount: 260, icon: 'icon-lotus', label: '260 Tu Vi' }],
  },
  {
    id: 'novice-12-gate-boss', category: 'main', title: 'Boss Tân Thủ trấn cửa ải', giver: 'Tu Sĩ Ẩn Cư',
    location: 'Cổng Bạch Vân Sơn', summary: 'Đánh bại Trấn Quan Tân Thủ. Khi quái gục, cổng sang Bạch Vân Sơn sẽ mở.',
    objective: 'Đánh bại Trấn Quan Tân Thủ', target: 1, initialStatus: 'available', initialProgress: 0,
    eventType: 'monster_kill', targetMonsterId: 'BOSS_TAN_THU', targetMapCode: 'thanh_van_son_coc', requiresQuestId: 'novice-11-boss-preparation',
    rewards: [{ type: 'xu', amount: 500, icon: 'icon-coins', label: '500 Xu' }, { type: 'tuVi', amount: 600, icon: 'icon-lotus', label: '600 Tu Vi' }],
  },
]);

function makeSnapshot(meta, states, definitions = QUEST_DEFINITIONS) {
  return {
    revision: Number(meta?.revision || 0),
    trackedId: meta?.trackedId || null,
    quests: definitions.map((definition) => {
      const state = states.find((entry) => entry.questId === definition.id);
      const prerequisite = definition.requiresQuestId
        ? definitions.find((entry) => entry.id === definition.requiresQuestId)
        : null;
      const prerequisiteState = definition.requiresQuestId
        ? states.find((entry) => entry.questId === definition.requiresQuestId)
        : null;
      const storedStatus = state?.status || definition.initialStatus;
      const locked = storedStatus === 'available' && Boolean(definition.requiresQuestId)
        && prerequisiteState?.status !== 'completed';
      return {
        id: definition.id,
        category: definition.category,
        title: definition.title,
        giver: definition.giver,
        location: definition.location,
        summary: definition.summary,
        objective: definition.objective,
        progress: Number(state?.progress ?? definition.initialProgress),
        target: definition.target,
        status: locked ? 'locked' : storedStatus,
        requiresQuestTitle: prerequisite?.title || null,
        rewards: definition.rewards.map(({ icon, label }) => ({ icon, label })),
      };
    }),
  };
}

module.exports = { QUEST_DEFINITIONS, makeSnapshot };
