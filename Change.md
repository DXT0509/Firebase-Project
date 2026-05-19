10/5: 
Fix race condition khi nhiều client cùng ăn 1 food item trong cùng một thời điểm. Hiện tại client tự detect collision ở local rồi tự xóa food và cộng score — nếu 2 client collision với cùng 1 foodId trong cùng 1 tick, cả 2 đều xóa food và nhận điểm, gây double reward.

Giải pháp: dùng **Firebase RTDB `runTransaction`** để biến thao tác "xóa food + cộng score" thành atomic operation. Chỉ 1 client thắng transaction, client còn lại tự động không nhận điểm.
