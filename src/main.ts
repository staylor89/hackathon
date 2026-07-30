import StartGame from './game/main';

document.addEventListener('DOMContentLoaded', () => {

    //  Kept on window so the browser console (and headless test drivers) can
    //  reach the scenes: game.scene.getScene('Game').
    (window as any).game = StartGame('game-container');

});