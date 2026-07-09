/** Tiny i18n: RU/EN dictionary + `t(key)`. Changing language re-renders the app
 *  (App subscribes via onLangChange). Strings not in the dict fall back to the key. */
export type Lang = 'ru' | 'en'

const KEY = 'gh_lang'
let lang: Lang = load()
const listeners = new Set<() => void>()

function load(): Lang {
  try {
    return localStorage.getItem(KEY) === 'en' ? 'en' : 'ru'
  } catch {
    return 'ru'
  }
}

export function getLang(): Lang {
  return lang
}

export function setLang(l: Lang) {
  lang = l
  try {
    localStorage.setItem(KEY, l)
  } catch {
    // ignore
  }
  listeners.forEach((f) => f())
}

export function onLangChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

type Entry = { ru: string; en: string }

const D: Record<string, Entry> = {
  // nav
  'nav.games': { ru: 'Игры', en: 'Games' },
  'nav.store': { ru: 'Магазин', en: 'Store' },
  'nav.profile': { ru: 'Профиль', en: 'Profile' },
  // common
  'common.cancel': { ru: 'Отмена', en: 'Cancel' },
  'common.save': { ru: 'Сохранить', en: 'Save' },
  'common.buy': { ru: 'Купить', en: 'Buy' },
  'common.choose': { ru: 'Выбрать', en: 'Select' },
  'common.chosen': { ru: 'Выбрано', en: 'Selected' },
  'common.delete': { ru: 'Удалить', en: 'Delete' },
  'common.back': { ru: 'Назад', en: 'Back' },
  'common.menu': { ru: 'В меню', en: 'Menu' },
  'common.online': { ru: 'в сети', en: 'online' },
  'common.offline': { ru: 'не в сети', en: 'offline' },
  'unit.cards': { ru: 'карт', en: 'cards' },
  'unit.min': { ru: 'мин', en: 'min' },
  // profile
  'profile.title': { ru: 'Профиль', en: 'Profile' },
  'profile.elo': { ru: 'Elo рейтинг', en: 'Elo rating' },
  'profile.games': { ru: 'Партий', en: 'Games' },
  'profile.wins': { ru: 'Побед', en: 'Wins' },
  'profile.losses': { ru: 'Поражений', en: 'Losses' },
  'profile.winrate': { ru: 'Винрейт', en: 'Winrate' },
  'profile.favGames': { ru: 'Любимые игры', en: 'Favorite games' },
  'profile.friends': { ru: 'Друзья', en: 'Friends' },
  'profile.rename': { ru: 'Сменить имя', en: 'Change name' },
  'profile.darkTheme': { ru: 'Тёмная тема', en: 'Dark theme' },
  'profile.language': { ru: 'Язык', en: 'Language' },
  'profile.history': { ru: 'История матчей', en: 'Match history' },
  'profile.renameTitle': { ru: 'Сменить имя', en: 'Change name' },
  'profile.namePlaceholder': { ru: 'Ваше имя', en: 'Your name' },
  // home
  'home.playWhat': { ru: 'Во что сыграем?', en: 'What shall we play?' },
  'home.popular': { ru: 'Популярные игры', en: 'Popular games' },
  'home.playing': { ru: 'играют', en: 'playing' },
  'home.moreGames': { ru: 'Больше игр', en: 'More games' },
  'home.comingSoon': { ru: 'Скоро в GameHub', en: 'Coming soon to GameHub' },
  'home.soon': { ru: 'Скоро', en: 'Soon' },
  'home.inviteFriend': { ru: 'Позови друга', en: 'Invite a friend' },
  'home.yourElo': { ru: 'Твой Elo', en: 'Your Elo' },
  'home.inviteHint': { ru: 'Вы оба получите бонус GRAM на баланс', en: 'You both get a GRAM bonus' },
  'home.inviteBtn': { ru: 'Пригласить', en: 'Invite' },
  // games
  'game.chess': { ru: 'Шахматы', en: 'Chess' },
  'game.durak': { ru: 'Дурак', en: 'Durak' },
  'game.nardy': { ru: 'Нарды', en: 'Backgammon' },
  // friends
  'friends.title': { ru: 'Друзья', en: 'Friends' },
  'friends.online': { ru: 'в сети', en: 'online' },
  'friends.add': { ru: 'Добавить друга', en: 'Add a friend' },
  'friends.addHint': {
    ru: 'Отправь ссылку. Друг откроет — и вы добавитесь друг к другу.',
    en: 'Share the link. When your friend opens it, you become friends.',
  },
  'friends.shareLink': { ru: 'Поделиться ссылкой', en: 'Share link' },
  'friends.emptyTitle': { ru: 'Пока никого нет', en: 'No friends yet' },
  'friends.emptyHint': { ru: 'Пригласи друга по ссылке выше', en: 'Invite a friend with the link above' },
  'friends.removeTitle': { ru: 'Удалить из друзей?', en: 'Remove friend?' },
  // history
  'history.title': { ru: 'История матчей', en: 'Match history' },
  'history.win': { ru: 'Победа', en: 'Win' },
  'history.loss': { ru: 'Поражение', en: 'Loss' },
  'history.draw': { ru: 'Ничья', en: 'Draw' },
  'history.emptyTitle': { ru: 'Пока нет матчей', en: 'No matches yet' },
  'history.emptyHint': { ru: 'Сыграй онлайн — партии появятся здесь', en: 'Play online — matches will appear here' },
  // store
  'store.title': { ru: 'Магазин', en: 'Store' },
  'store.piecesChess': { ru: 'Фигуры · Шахматы', en: 'Pieces · Chess' },
  'store.boardsChess': { ru: 'Доски · Шахматы', en: 'Boards · Chess' },
  'store.backsDurak': { ru: 'Рубашки · Дурак', en: 'Card backs · Durak' },
  'store.feltsDurak': { ru: 'Полотна · Дурак', en: 'Table felts · Durak' },
  'store.checkersNardy': { ru: 'Фишки · Нарды', en: 'Checkers · Backgammon' },
  'store.buyVip': { ru: 'Купить VIP', en: 'Buy VIP' },
  'store.youVip': { ru: 'Вы VIP', en: 'You are VIP' },
  'store.vipTitle': { ru: 'VIP статус', en: 'VIP status' },
  'store.purchase': { ru: 'Покупка', en: 'Purchase' },
  'store.payWithStars': { ru: 'Оплата звёздами Telegram', en: 'Pay with Telegram Stars' },
  'store.buyFor': { ru: 'Купить за', en: 'Buy for' },
  // matchmaking
  'mm.searching': { ru: 'Поиск соперника…', en: 'Finding an opponent…' },
  'mm.waitingFriend': { ru: 'Ждём друга…', en: 'Waiting for a friend…' },
  'mm.joining': { ru: 'Заходим в игру…', en: 'Joining the game…' },
  // invite banner
  'invite.calls': { ru: 'зовёт в партию', en: 'invites you to a game' },
  'invite.join': { ru: 'Зайти', en: 'Join' },
  'invite.offline': { ru: 'Друг сейчас не в сети', en: 'Your friend is offline' },
  'invite.notFound': { ru: 'Партия не найдена или уже началась', en: 'Match not found or already started' },
}

export function t(key: string): string {
  const e = D[key]
  return e ? e[lang] : key
}
