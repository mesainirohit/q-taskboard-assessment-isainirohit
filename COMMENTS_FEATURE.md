# Task Comments Feature - Implementation Guide

## Overview
The task comments feature allows project members to post and view comments on tasks. Comments are append-only (immutable after creation) and support proper role-based access control.

---

## Database Schema

### Comment Model
```prisma
model Comment {
  id        String   @id @default(cuid())
  taskId    String   @map("task_id")
  authorId  String   @map("author_id")
  body      String   @db.Text
  createdAt DateTime @default(now()) @map("created_at")

  task   Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
  author User @relation(fields: [authorId], references: [id], onDelete: Cascade)

  @@index([taskId, createdAt])
  @@map("comments")
}
```

### Key Design Decisions

| Feature | Decision | Reason |
|---------|----------|--------|
| **No Edit/Delete** | Append-only | Immutable for audit trail and integrity |
| **Index on (taskId, createdAt)** | Sorted retrieval | Efficient chronological ordering |
| **CASCADE delete** | Auto-cleanup | When task/user deleted, comments removed |
| **Text field for body** | PostgreSQL TEXT | No size limit constraint |
| **Single createdAt** | No updatedAt | Immutable, only created timestamp needed |

### Relationships

```
User (1)
  ↓ (authored)
Comment (many)
  ↓ (on)
Task (1)
  ↓ (in)
Project (1)
```

**User Model Update:**
Added `comments Comment[]` relationship to track comments by author.

**Task Model Update:**
Added `comments Comment[]` relationship to track comments on task.

---

## API Endpoints

### GET /api/tasks/{taskId}/comments

**Purpose:** Retrieve all comments for a task in chronological order

**Authentication:** Required (Bearer token)

**Authorization:** 
- ✅ Admin: Can read
- ✅ Member: Can read
- ✅ Viewer: Can read
- ❌ Non-member: Cannot access (403 Forbidden)
- ❌ Unauthenticated: Cannot access (401 Unauthorized)

**Request:**
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/tasks/{taskId}/comments
```

**Success Response (200 OK):**
```json
{
  "comments": [
    {
      "id": "cuid_1",
      "taskId": "task_123",
      "authorId": "user_1",
      "body": "This is a comment",
      "createdAt": "2026-06-03T10:00:00Z",
      "author": {
        "id": "user_1",
        "email": "alice@example.com",
        "name": "Alice"
      }
    },
    {
      "id": "cuid_2",
      "taskId": "task_123",
      "authorId": "user_2",
      "body": "Another comment",
      "createdAt": "2026-06-03T10:05:00Z",
      "author": {
        "id": "user_2",
        "email": "bob@example.com",
        "name": "Bob"
      }
    }
  ]
}
```

**Error Responses:**
- `401 Unauthorized` - No token or invalid token
- `403 Forbidden` - Not a project member
- `404 Not Found` - Task does not exist

---

### POST /api/tasks/{taskId}/comments

**Purpose:** Create a new comment on a task

**Authentication:** Required (Bearer token)

**Authorization:**
- ✅ Admin: Can post
- ✅ Member: Can post
- ❌ Viewer: Cannot post (403 Forbidden)
- ❌ Non-member: Cannot post (403 Forbidden)
- ❌ Unauthenticated: Cannot post (401 Unauthorized)

**Request:**
```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"body": "This is my comment"}' \
  http://localhost:3000/api/tasks/{taskId}/comments
```

**Request Body Schema:**
```typescript
{
  body: string;        // 1-5000 characters, required
}
```

**Success Response (201 Created):**
```json
{
  "comment": {
    "id": "cuid_123",
    "taskId": "task_456",
    "authorId": "user_789",
    "body": "This is my comment",
    "createdAt": "2026-06-03T10:15:00Z",
    "author": {
      "id": "user_789",
      "email": "charlie@example.com",
      "name": "Charlie"
    }
  }
}
```

**Error Responses:**
- `400 Bad Request` - Invalid input (empty body, exceeds max length, malformed JSON)
  ```json
  {
    "error": "invalid input",
    "details": {
      "fieldErrors": {
        "body": ["comment cannot be empty"]
      }
    }
  }
  ```
- `401 Unauthorized` - No token or invalid token
- `403 Forbidden` - Not a project member OR viewer role
  ```json
  {
    "error": "viewers cannot post comments"
  }
  ```
- `404 Not Found` - Task does not exist

---

## Validation Schema

### createCommentSchema (Zod)
```typescript
export const createCommentSchema = z.object({
  body: z.string()
    .min(1, "comment cannot be empty")
    .max(5000, "comment must be less than 5000 characters"),
});
```

**Validation Rules:**
- `body` must be a non-empty string
- `body` must not exceed 5000 characters
- No other fields accepted

---

## Type Definitions

### ApiComment
```typescript
export type ApiComment = {
  id: string;           // Generated CUID
  taskId: string;       // Task this comment belongs to
  authorId: string;     // User who created the comment
  body: string;         // Comment text
  createdAt: string;    // ISO 8601 timestamp
  author: ApiUser;      // Author's user information
};
```

### CreateCommentInput
```typescript
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
// Equivalent to: { body: string }
```

---

## Authorization Rules

### Role-Based Access Control (RBAC)

| Action | Admin | Member | Viewer | Non-Member |
|--------|-------|--------|--------|------------|
| **Read Comments** | ✅ | ✅ | ✅ | ❌ |
| **Post Comments** | ✅ | ✅ | ❌ | ❌ |
| **Edit Comments** | ❌ | ❌ | ❌ | ❌ |
| **Delete Comments** | ❌ | ❌ | ❌ | ❌ |

### Authorization Flow

```
1. Parse Bearer token → Get userId
2. Fetch task → Get projectId
3. Check project membership → Get role
4. For GET:
   - Any member can read
5. For POST:
   - Only admin/member can post
   - Viewers blocked at endpoint level
6. Comments are immutable:
   - No PATCH/DELETE endpoints exist
   - Database constraint: no update fields
```

### Helper Function
```typescript
export function canPostComments(role: ProjectRole | null | undefined): boolean {
  return role === "admin" || role === "member";
}
```

---

## Implementation Files

### 1. Database Schema
**File:** `prisma/schema.prisma`
- Added `Comment` model
- Updated `User` model with `comments` relationship
- Updated `Task` model with `comments` relationship
- Index on `(taskId, createdAt)` for efficient queries

### 2. Validation Schema
**File:** `src/schemas/comment.ts`
- `createCommentSchema`: Zod schema for comment body validation
- `CreateCommentInput`: TypeScript type

### 3. Type Definitions
**File:** `src/types/index.ts`
- `ApiComment`: Comment API response type

### 4. Authorization Helper
**File:** `src/lib/auth.ts`
- `canPostComments()`: Role check for posting comments

### 5. API Route Handlers
**File:** `src/app/api/tasks/[taskId]/comments/route.ts`
- `GET`: Fetch comments with authorization checks
- `POST`: Create comment with validation and authorization

### 6. Test Suite
**File:** `src/tests/comments.authorization.test.ts`
- 16 test cases covering all authorization scenarios
- Tests for data integrity and append-only constraint

---

## Database Migration

To apply the schema changes, run:

```bash
# Generate migration
npx prisma migrate dev --name add_comments

# Or deploy existing migration
npx prisma migrate deploy

# Generate Prisma client
npx prisma generate
```

**Migration Changes:**
- Creates `comments` table with proper indexes and foreign keys
- Adds `comments` relationship to `users` table
- Adds `comments` relationship to `tasks` table

---

## Features

✅ **Chronological ordering** - Comments displayed in creation order (ASC by createdAt)

✅ **Author attribution** - Each comment shows full author info (id, name, email)

✅ **Role-based access** - Admins/members can post, viewers can only read

✅ **Append-only** - Comments cannot be edited or deleted after creation

✅ **Project isolation** - Only project members can access comments

✅ **Cascade deletion** - Comments deleted when task/user deleted

✅ **Validation** - Comment body must be 1-5000 characters

✅ **Efficient queries** - Indexed by (taskId, createdAt) for fast retrieval

---

## Security Considerations

### ✅ Implemented

1. **Authentication required** - All endpoints need valid JWT token
2. **Authorization enforced** - Project membership verified
3. **Role-based access** - Viewers cannot post
4. **Input validation** - Body length limited to 5000 chars
5. **SQL injection prevention** - Prisma parameterized queries
6. **Cascade delete** - No orphaned records

### ⚠️ Additional Considerations

1. **Rate limiting** - Recommended to add on POST endpoint
2. **Content moderation** - Consider filtering inappropriate content
3. **Audit logging** - Track who posted what and when
4. **Soft deletes** - Consider for regulatory compliance
5. **Comment reactions** - Future feature (likes, reactions)

---

## Testing

### Run Tests
```bash
npm run test                    # Run all tests
npm run test:watch             # Watch mode
npm run test -- comments       # Run comments tests only
```

### Test Coverage

**Authorization Tests (16 cases):**
- Read authorization (5 tests)
- Post authorization (5 tests)
- Data integrity (3 tests)
- Edge cases (3 tests)

**Test Scenarios:**
- ✅ Admin can read and post
- ✅ Member can read and post
- ✅ Viewer can read but not post
- ✅ Non-member cannot read or post
- ✅ Unauthenticated user blocked
- ✅ Empty comments rejected
- ✅ Oversized comments rejected
- ✅ Comments in chronological order
- ✅ Author info included

---

## Usage Examples

### Example 1: Member posting a comment
```bash
PROJECT_ID="proj_123"
TASK_ID="task_456"
TOKEN=$(npm run get-token -- user@example.com)

curl -X POST "http://localhost:3000/api/tasks/$TASK_ID/comments" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"body": "This task needs review"}'
```

### Example 2: Viewer trying to post (blocked)
```bash
VIEWER_TOKEN=$(npm run get-token -- viewer@example.com)

curl -X POST "http://localhost:3000/api/tasks/$TASK_ID/comments" \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"body": "Trying to post as viewer"}' 

# Response: 403 Forbidden
# {"error": "viewers cannot post comments"}
```

### Example 3: Reading comments chronologically
```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/tasks/$TASK_ID/comments"

# Returns array sorted by createdAt ASC
# [comment1 (oldest), comment2, comment3 (newest)]
```

---

## Future Enhancements

- [ ] Comment reactions (👍 ❤️ 🔥)
- [ ] Mention system (@user tags)
- [ ] Comment search
- [ ] Threaded replies
- [ ] Edit with history tracking
- [ ] Comment webhooks
- [ ] Email notifications
- [ ] Real-time comment updates (WebSocket)

---

## Troubleshooting

### Migration fails
```bash
# Reset database (development only)
npx prisma migrate reset --skip-seed
```

### Tests fail on authorization
```bash
# Verify JWT_SECRET is set
echo $JWT_SECRET

# Regenerate test tokens
npm run test -- comments --reporter=verbose
```

### Comments not appearing
- Check task exists: `GET /api/tasks/{taskId}`
- Verify project membership: `GET /api/projects`
- Check created comment: response should include full comment object

