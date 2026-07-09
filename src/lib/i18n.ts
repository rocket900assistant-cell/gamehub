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
  'profile.eloHint': { ru: 'Сыграй онлайн-партии — здесь появится график рейтинга', en: 'Play online matches — your rating chart will appear here' },
  'profile.renameTitle': { ru: 'Сменить имя', en: 'Change name' },
  'profile.namePlaceholder': { ru: 'Ваше имя', en: 'Your name' },
  // header + promo
  'header.tagline': { ru: 'Играй. Побеждай. Соревнуйся', en: 'Play. Win. Compete' },
  'promo.buyGram': { ru: 'Купить GRAM за рубли', en: 'Buy GRAM' },
  'promo.buyGramHint': { ru: 'По СБП · мгновенное зачисление', en: 'Instant top-up' },
  'promo.buy': { ru: 'Купить', en: 'Buy' },
  // home
  'home.playWhat': { ru: 'Во что сыграем?', en: 'What shall we play?' },
  'home.popular': { ru: 'Популярные игры', en: 'Popular games' },
  'home.playing': { ru: 'играют', en: 'playing' },
  'home.moreGames': { ru: 'Больше игр', en: 'More games' },
  'home.comingSoon': { ru: 'Скоро в GameHub', en: 'Coming soon to GameHub' },
  'home.soon': { ru: 'Скоро', en: 'Soon' },
  'home.inviteFriend': { ru: 'Позови друга', en: 'Invite a friend' },
  'home.yourElo': { ru: 'Твой Elo', en: 'Your Elo' },
  'home.inviteHint': { ru: 'Приглашай друзей. Играйте вместе и получайте бонусы', en: 'Invite friends. Play together and earn bonuses' },
  'home.inviteBtn': { ru: 'Пригласить', en: 'Invite' },
  // games
  'game.chess': { ru: 'Шахматы', en: 'Chess' },
  'game.durak': { ru: 'Дурак', en: 'Durak' },
  'game.nardy': { ru: 'Нарды', en: 'Backgammon' },
  'game.poker': { ru: 'Покер', en: 'Poker' },
  'game.checkers': { ru: 'Шашки', en: 'Checkers' },
  'game.tictactoe': { ru: 'Крестики', en: 'Tic-tac-toe' },
  // resume banners
  'resume.title': { ru: 'Вернуться в партию', en: 'Back to the game' },
  'resume.inProgress': { ru: 'идёт игра', en: 'in progress' },
  // skin names
  'skin.default': { ru: 'Классика', en: 'Classic' },
  'skin.green': { ru: 'Классик зелёный', en: 'Classic green' },
  'skin.grey': { ru: 'Серый', en: 'Grey' },
  'skin.pink': { ru: 'Розовый', en: 'Pink' },
  'skin.marble': { ru: 'Мрамор', en: 'Marble' },
  'skin.blue-marble': { ru: 'Синий мрамор', en: 'Blue marble' },
  'skin.back-default': { ru: 'Классика', en: 'Classic' },
  'skin.back-emerald': { ru: 'Изумруд', en: 'Emerald' },
  'skin.back-royal': { ru: 'Королевская', en: 'Royal' },
  'skin.felt-default': { ru: 'Синяя кожа', en: 'Blue leather' },
  'skin.felt-cream': { ru: 'Кремовое', en: 'Cream' },
  'skin.felt-green': { ru: 'Зелёное сукно', en: 'Green cloth' },
  'skin.felt-burgundy': { ru: 'Бордовый бархат', en: 'Burgundy velvet' },
  'skin.checker-default': { ru: 'Классика', en: 'Classic' },
  'skin.checker-emerald': { ru: 'Изумруд', en: 'Emerald' },
  'skin.checker-royal': { ru: 'Оникс-Роял', en: 'Onyx Royal' },
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
  // setup screens
  'setup.quickOnline': { ru: 'Быстрая игра (онлайн)', en: 'Quick game (online)' },
  'setup.quick': { ru: 'Быстрая игра', en: 'Quick game' },
  'setup.withFriend': { ru: 'Играть с другом', en: 'Play with a friend' },
  'setup.withBot': { ru: 'Играть с ботом', en: 'Play vs bot' },
  'setup.free': { ru: 'Бесплатно', en: 'Free' },
  'setup.onGram': { ru: 'На GRAM', en: 'For GRAM' },
  'setup.yourStake': { ru: 'Ваша ставка', en: 'Your stake' },
  'setup.timeControl': { ru: 'Контроль времени', en: 'Time control' },
  'setup.createGame': { ru: 'Создать игру', en: 'Create game' },
  'nardy.title': { ru: 'Нарды', en: 'Backgammon' },
  'nardy.desc': { ru: 'Длинные нарды. 2 минуты на ход.', en: 'Long backgammon. 2 minutes per move.' },
  'chess.title': { ru: 'Шахматы', en: 'Chess' },
  'chess.blitz': { ru: 'Блиц', en: 'Blitz' },
  'chess.rapid': { ru: 'Рапид', en: 'Rapid' },
  'durak.title': { ru: 'Создать игру', en: 'Create game' },
  'durak.players': { ru: 'Игроки', en: 'Players' },
  'durak.deck': { ru: 'Колода', en: 'Deck' },
  'durak.speed': { ru: 'Скорость', en: 'Speed' },
  'durak.speedNormal': { ru: 'Обычная', en: 'Normal' },
  'durak.speedFast': { ru: 'Быстрая', en: 'Fast' },
  'durak.modes': { ru: 'Режимы', en: 'Modes' },
  'durak.privateGame': { ru: 'Приватная игра', en: 'Private game' },
  'durak.privateHint': { ru: 'Только по ссылке-приглашению', en: 'Invite link only' },
  'durak.mode.podkidnoy': { ru: 'Подкидной', en: 'Classic' },
  'durak.mode.perevodnoy': { ru: 'Переводной', en: 'Transfer' },
  'durak.mode.sosedi': { ru: 'Соседи', en: 'Neighbours' },
  'durak.mode.vse': { ru: 'Все', en: 'All' },
  'durak.mode.klassika': { ru: 'Классика', en: 'Classic' },
  'durak.mode.nichya': { ru: 'Ничья', en: 'Draw' },
  // in-match
  'match.bot': { ru: 'Бот', en: 'Bot' },
  'match.onlineWord': { ru: 'онлайн', en: 'online' },
  'match.vsBot': { ru: 'с ботом', en: 'vs bot' },
  'match.training': { ru: 'тренировка', en: 'training' },
  'match.rated': { ru: 'рейтинг', en: 'rated' },
  'match.bank': { ru: 'банк', en: 'pot' },
  'match.moves': { ru: 'Ходы', en: 'Moves' },
  'match.chat': { ru: 'Чат', en: 'Chat' },
  'match.back': { ru: 'Назад', en: 'Back' },
  'match.forward': { ru: 'Вперёд', en: 'Forward' },
  'match.noMoves': { ru: 'Ходов пока нет', en: 'No moves yet' },
  'match.noMessages': { ru: 'Сообщений пока нет', en: 'No messages yet' },
  'match.messagePlaceholder': { ru: 'Сообщение…', en: 'Message…' },
  'match.checkmate': { ru: 'Шах и мат!', en: 'Checkmate!' },
  'match.victory': { ru: 'Победа!', en: 'Victory!' },
  'match.youWon': { ru: 'Вы выиграли!', en: 'You won!' },
  'match.defeat': { ru: 'Поражение', en: 'Defeat' },
  'match.youLost': { ru: 'Вы проиграли', en: 'You lost' },
  'match.draw': { ru: 'Ничья', en: 'Draw' },
  'match.aborted': { ru: 'Партия отменена', en: 'Game aborted' },
  'match.resignQ': { ru: 'Сдаться?', en: 'Resign?' },
  'match.resign': { ru: 'Сдаться', en: 'Resign' },
  'match.resignWarn': { ru: 'Засчитается как поражение', en: 'Counts as a loss' },
  'match.resignWarnStake': { ru: 'Засчитается поражение — ставка уйдёт сопернику.', en: 'Counts as a loss — the stake goes to your opponent.' },
  'match.resignWarnRating': { ru: 'Засчитается поражение — потеряете рейтинг.', en: 'Counts as a loss — you lose rating.' },
  'match.rematch': { ru: 'Реванш', en: 'Rematch' },
  'match.again': { ru: 'Ещё раз', en: 'Again' },
  'match.toMenu': { ru: 'В меню', en: 'Menu' },
  'match.botUnrated': { ru: 'Игра с ботом · без рейтинга', en: 'Bot game · unrated' },
  'match.onlineGame': { ru: 'Онлайн-партия', en: 'Online match' },
  'match.onGram': { ru: 'Игра на GRAM', en: 'GRAM game' },
  'match.noPenalty': { ru: 'Без штрафа', en: 'No penalty' },
  'match.rollDice': { ru: 'Бросить кубики', en: 'Roll the dice' },
  'match.opponentMove': { ru: 'Ход соперника', en: "Opponent's move" },
  'match.ready': { ru: 'Готов', en: 'Ready' },
  'match.readyPrompt': { ru: 'Нажмите «Готов»', en: 'Press “Ready”' },
  'match.done': { ru: 'Готово', en: 'Done' },
  'match.beat': { ru: 'Бито', en: 'Beat' },
  'match.take': { ru: 'Взять', en: 'Take' },
  'match.yourTurnAttack': { ru: 'Ваш ход — атакуйте', en: 'Your turn — attack' },
  'match.yourTurnDefend': { ru: 'Ваш ход — защищайтесь', en: 'Your turn — defend' },
  'match.opponentTurn': { ru: 'Ход соперника', en: "Opponent's turn" },
  'durak.oppTaking': { ru: 'Соперник забирает…', en: 'Opponent is taking…' },
  'durak.oppTurn': { ru: 'Ход соперника…', en: "Opponent's turn…" },
  'durak.canThrowIn': { ru: 'Можно подкинуть, затем «Готово»', en: 'You can throw in, then “Done”' },
  'durak.throwOrBeat': { ru: 'Подкиньте карту или «Бито»', en: 'Throw in a card or “Beat”' },
  'durak.attack': { ru: 'Ваш ход — атакуйте', en: 'Your turn — attack' },
  'durak.defendTransferTake': { ru: 'Отбейтесь, переведите или берите', en: 'Defend, transfer or take' },
  'durak.defendOrTake': { ru: 'Отбивайтесь или берите', en: 'Defend or take' },
  'nardy.you': { ru: 'Вы', en: 'You' },
  'nardy.off': { ru: 'вышло', en: 'off' },
  'nardy.invite': { ru: 'Пригласить', en: 'Invite' },
  'reason.mate': { ru: 'Объявлен мат', en: 'Checkmate' },
  'reason.time': { ru: 'По времени', en: 'On time' },
  'reason.resign': { ru: 'Сдача', en: 'Resignation' },
  'reason.draw': { ru: 'Ничья', en: 'Draw' },
  'reason.abandon': { ru: 'Соперник вышел', en: 'Opponent left' },
  // matchmaking
  'mm.searching': { ru: 'Поиск соперника…', en: 'Finding an opponent…' },
  'mm.waitingFriend': { ru: 'Ждём друга…', en: 'Waiting for a friend…' },
  'mm.joining': { ru: 'Заходим в игру…', en: 'Joining the game…' },
  'mm.byInvite': { ru: 'по приглашению', en: 'by invite' },
  'mm.cancel': { ru: 'Отменить', en: 'Cancel' },
  'mm.connecting': { ru: 'Подключение к сопернику', en: 'Connecting to opponent' },
  'common.opponent': { ru: 'Соперник', en: 'Opponent' },
  'common.friend': { ru: 'Друг', en: 'Friend' },
  'mode.transfer': { ru: 'переводной', en: 'transfer' },
  'mode.podkidnoy': { ru: 'подкидной', en: 'classic' },
  // invite banner
  'invite.calls': { ru: 'зовёт в партию', en: 'invites you to a game' },
  'invite.join': { ru: 'Зайти', en: 'Join' },
  'invite.offline': { ru: 'Друг сейчас не в сети', en: 'Your friend is offline' },
  'invite.notFound': { ru: 'Партия не найдена или уже началась', en: 'Match not found or already started' },
  'invite.playWithFriend': { ru: 'Игра с другом', en: 'Play with a friend' },
  'invite.shareText': { ru: 'Заходи сыграть со мной в GameHub!', en: 'Come play with me on GameHub!' },
  'invite.fromFriends': { ru: 'Пригласить из друзей', en: 'Invite a friend' },
  'invite.orByLink': { ru: 'Или по ссылке', en: 'Or by link' },
  'invite.invite': { ru: 'Пригласить', en: 'Invite' },
  'invite.invited': { ru: 'Приглашён', en: 'Invited' },
  'invite.noFriends': {
    ru: 'Пока нет друзей. Пригласи их по ссылке ниже — как добавят, появятся здесь.',
    en: 'No friends yet. Invite them with the link below — they’ll appear here once added.',
  },
  'invite.creatingLink': { ru: 'Создаём ссылку…', en: 'Creating link…' },
  'invite.showAll': { ru: 'Показать всех', en: 'Show all' },
  'invite.collapse': { ru: 'Свернуть', en: 'Collapse' },
}

export function t(key: string): string {
  const e = D[key]
  return e ? e[lang] : key
}

/** Like t(), but returns `fallback` when the key isn't in the dictionary. */
export function tf(key: string, fallback: string): string {
  const e = D[key]
  return e ? e[lang] : fallback
}
