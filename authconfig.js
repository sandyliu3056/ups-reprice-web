/* 本機帳號模式:有 localUser 這一塊時,整個網站完全不使用 Supabase ——
   不連線、不需要任何 Supabase 設定。登入就比對這裡的帳號與密碼雜湊。

   密碼「不是」明碼存放:passwordSha256 是密碼的 SHA-256 雜湊,
   看到這個檔案的人推不回原本的密碼。要換密碼就要換一個新的雜湊值
   (可以請幫你設定的人重算一個)。

   之後想改回 Supabase 登入:把 localUser 這一塊整段刪掉,
   並把下面的 url / anonKey 兩行取消註解即可。 */
window.UPS_AUTH_CONFIG = {
  localUser: {
    username: "sandy",
    displayName: "Sandy",
    role: "admin",
    passwordSha256: "95c761a4f0b80e9707073e40343af064ba5256a85286def1f625e1e58d136fbe"
  }
  /* Supabase 模式(目前停用):
  ,url: "https://snalvdjsnysutmkqjyaa.supabase.co"
  ,anonKey: "sb_publishable_qnJcmZzCIb__E_PVxUcZJA_hdHadXlw"
  */
};
