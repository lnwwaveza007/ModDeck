# GitHub Protocol ⚙️

## Branch 🩼

- `main` สำหรับ production เท่านั้น ห้าม push ตรง ต้องขอ Pull Request เท่านั้น ⚠️
- `dev` ทุกอย่างที่กำลังพัฒนามารวมที่นี่ ให้มั่นใจก่อน แล้วค่อยขึ้น `main`

### Branch naming

`<type>/<short-desc>`

| type       | ใช้เมื่อ                              |
| ---------- | ------------------------------------- |
| `feat`     | ฟีเจอร์ใหม่                           |
| `fix`      | แก้บั๊ก                               |
| `refactor` | ปรับปรุงโค้ด                          |
| `style`    | แก้ไข UI                              |
| `test`     | เพิ่มหรือแก้เทส                       |
| `chore`    | งานอื่นๆ เช่น config, build, dependency |

ตัวอย่าง

- `feat/add-login-page`
- `fix/header-responsive`
- `refactor/clean-code-dashboard`

## Commit message 💬

`<type>: <short message>`

ตัวอย่าง

- `feat: add tomato to ketchup`

## Pull Request protocol 🫷

### Title

`<type>: <heading>`

ตัวอย่าง: `fix: patch crash on mobile`

### Description template

Headings stay in Thai. Write the body under each heading in English.

```markdown
## ✨ ทำอะไรไปบ้าง?

desc

## 🧪 ทดสอบยังไง?

desc

## 📎 เพิ่มเติม

desc
```

ตัวอย่าง

```markdown
## ✨ ทำอะไรไปบ้าง?

Add a Profile page for users, and fix the logout button that did not log the user out.

## 🧪 ทดสอบยังไง?

Open Profile, then press Logout. There is no error and the app goes to the login page.

## 📎 เพิ่มเติม

Please check that the logout button works on mobile.
```
