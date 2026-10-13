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

เพิ่มหน้า Profile สำหรับผู้ใช้ พร้อมแก้บั๊กปุ่ม logout ที่กดแล้วไม่ออก

## 🧪 ทดสอบยังไง?

ลองกดเข้า Profile / Logout แล้ว ไม่มี error และพาไปหน้า login ได้ปกติ

## 📎 เพิ่มเติม

ช่วยลองดูว่าปุ่ม logout ทำงานปกติใน mobile รึเปล่า
```
