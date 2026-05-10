import { ref as dbRef, runTransaction } from 'firebase/database';
import { getRoomCollectionPath } from '../firebase/paths';

export const getFoodScoreValue = (size) => {
	if (size === 1) return 8;
	if (size === 2) return 19;
	return 40;
};

export const consumeFoodTransaction = async (db, roomId, foodId) => {
	const foodRef = dbRef(db, `${getRoomCollectionPath(roomId, 'food')}/${foodId}`);
	return runTransaction(foodRef, (currentData) => {
		if (currentData === null) {
			return undefined;
		}
		return null;
	});
};
