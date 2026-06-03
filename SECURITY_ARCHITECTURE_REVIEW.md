# Taskboard Project - Security, Performance & Architecture Review

## 1. DIRECTORY STRUCTURE & MAIN COMPONENTS

```
taskboard/
├── src/
│   ├── app/
│   │   ├── api/                 # REST API endpoints (Next.js App Router)
│   │   │   ├── auth/           # Authentication (login, register)
│   │   │   ├── projects/       # Project CRUD operations
│   │   │   ├── tasks/          # Task CRUD operations
│   │   │   └── users/          # User endpoints
│   │   ├── dashboard/          # Main dashboard page
│   │   ├── projects/[id]/      # Project detail page (dynamic)
│   │   ├── login/              # Login page
│   │   ├── register/           # Registration page
│   │   └── layout.tsx          # Root layout
│   ├── components/             # Reusable React components
│   │   ├── Header.tsx
│   │   ├── TaskCard.tsx
│   │   ├── TaskDetail.tsx
│   │   └── StatusColumn.tsx
│   ├── lib/                    # Utility & core logic
│   │   ├── auth.ts             # Authentication helpers
│   │   ├── jwt.ts              # JWT token generation/verification
│   │   ├── prisma.ts           # Database client singleton
│   │   ├── airtable.ts         # Airtable API integration
│   │   └── api-client.ts       # Frontend fetch client
│   ├── schemas/                # Zod validation schemas
│   │   ├── auth.ts             # Auth validation
│   │   ├── project.ts
│   │   └── task.ts
│   ├── types/                  # TypeScript type definitions
│   └── tests/                  # Unit & component tests
├── prisma/
│   ├── schema.prisma           # Database schema (PostgreSQL)
│   ├── seed.ts                 # Database seeding script
│   └── migrations/             # Database migrations
├── package.json                # Dependencies & scripts
├── tsconfig.json               # TypeScript configuration
├── next.config.ts              # Next.js configuration
├── Dockerfile                  # Docker containerization
└── docker-compose.yml          # Docker Compose setup

Tech Stack:
- Frontend: Next.js 15.5.15, React 19, TailwindCSS
- Backend: Next.js API Routes (Node.js runtime)
- Database: PostgreSQL via Prisma ORM
- Auth: JWT (jsonwebtoken), bcryptjs for password hashing
- Validation: Zod
- External: Airtable integration
- Testing: Vitest
```

---

## 2. KEY FILES - AUTHENTICATION, PROJECTS, TASKS & USERS

### **A. Authentication Flow**

#### [src/lib/jwt.ts](src/lib/jwt.ts) - Token Management
```typescript
- Dependency on JWT_SECRET env variable (required)
- Token expiration: 30 days (RISKY - too long!)
- Payload: { userId, email }
```

#### [src/app/api/auth/register/route.ts](src/app/api/auth/register/route.ts) - User Registration
```typescript
- Validates email, password (8+ chars), name via Zod
- Hashes password with bcryptjs (10 salt rounds)
- Checks for duplicate emails before creation
- Returns JWT token on success
```

#### [src/app/api/auth/login/route.ts](src/app/api/auth/login/route.ts) - User Login
```typescript
- Validates email & password format
- Compares hashed password with bcryptjs
- Returns user + JWT token
```

#### [src/lib/auth.ts](src/lib/auth.ts) - Authorization Middleware
```typescript
- getCurrentUser(): Extracts & verifies JWT from Authorization header
- Queries user from database on every request (N+1 risk)
- Role-based access control (RBAC):
  - canEditProject(): only "admin" role
  - canEditTasks(): "admin" or "member" (viewers read-only)
- getProjectMembership(): Checks user's role in project
```

### **B. Projects Management**

#### [src/app/api/projects/route.ts](src/app/api/projects/route.ts)
```typescript
GET  /api/projects - List user's projects
- Fetches memberships + full project details + owner info + all tasks
- Includes unnecessary task data in response

POST /api/projects - Create project
- Validates: name (1-120 chars), description (optional, max 2000)
- Creates project with current user as owner
- Auto-adds user with admin role
```

#### [src/app/api/projects/[id]/route.ts](src/app/api/projects/[id]/route.ts)
```typescript
GET  /api/projects/[id] - Get project details
- Includes memberships, tasks with assignee & creator
- Role check via getProjectMembership()

PATCH /api/projects/[id] - Update project
- Admin-only: edit name/description

DELETE /api/projects/[id] - Delete project
- Admin-only: soft delete via Prisma
```

#### [src/app/api/projects/[id]/tasks/route.ts](src/app/api/projects/[id]/tasks/route.ts)
```typescript
GET /api/projects/[id]/tasks - List tasks with search
- CRITICAL SQL INJECTION VULNERABILITY (see #5 below)
- Raw SQL query with unsanitized search parameter
```

### **C. Tasks Management**

#### [src/app/api/tasks/[id]/route.ts](src/app/api/tasks/[id]/route.ts)
```typescript
PATCH /api/tasks/[id] - Update task
- Member+ can edit
- Syncs to Airtable if airtableId exists
- Status mapping: todo → Todo, in_progress → In Progress, etc.
- Silently fails Airtable sync on error (logs only)

DELETE /api/tasks/[id] - Delete task
- Member+ can delete
- Removes from Airtable if linked
- Hard delete (no soft delete)
```

### **D. Users Management**

#### [src/app/api/users/me/route.ts](src/app/api/users/me/route.ts)
```typescript
GET /api/users/me - Get current user
- Simple auth check + user return
```

---

## 3. API ENDPOINTS SUMMARY

| Method | Endpoint | Auth | Role | Purpose |
|--------|----------|------|------|---------|
| POST | `/api/auth/register` | ❌ | — | Register new user |
| POST | `/api/auth/login` | ❌ | — | Login & get JWT |
| GET | `/api/users/me` | ✅ | Any | Get current user |
| GET | `/api/projects` | ✅ | Any | List user's projects |
| POST | `/api/projects` | ✅ | Any | Create project |
| GET | `/api/projects/[id]` | ✅ | Member+ | Get project details |
| PATCH | `/api/projects/[id]` | ✅ | Admin | Update project |
| DELETE | `/api/projects/[id]` | ✅ | Admin | Delete project |
| GET | `/api/projects/[id]/tasks` | ✅ | Member+ | List tasks (+ search) |
| POST | `/api/projects/[id]/tasks` | ✅ | Member+ | Create task |
| PATCH | `/api/tasks/[id]` | ✅ | Member+ | Update task |
| DELETE | `/api/tasks/[id]` | ✅ | Member+ | Delete task |

---

## 4. OBVIOUS CODE SMELL AREAS

### 🔴 **CRITICAL ISSUES**

#### 1. **SQL INJECTION VULNERABILITY** 
**File:** [src/app/api/projects/[id]/tasks/route.ts](src/app/api/projects/[id]/tasks/route.ts)
```typescript
// LINE ~33: Raw SQL with unescaped user input
const sql = `
  SELECT ... FROM tasks
  WHERE project_id = '${projectId}'
    AND (title ILIKE '%${q}%' OR description ILIKE '%${q}%')
  ORDER BY position ASC
`;
const tasks = await prisma.$queryRawUnsafe(sql);
```
**Risk:** Attacker can inject SQL via `?q=` parameter
**Fix:** Use Prisma query builder with proper escaping:
```typescript
const tasks = await prisma.task.findMany({
  where: {
    projectId,
    OR: [
      { title: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } }
    ]
  },
  orderBy: { position: 'asc' }
});
```

#### 2. **JWT Token Expiration Too Long**
**File:** [src/lib/jwt.ts](src/lib/jwt.ts)
```typescript
const EXPIRES_IN = "30d";  // ⚠️ Very long!
```
**Risk:** Compromised token is valid for 30 days
**Recommendation:** Use 15 minutes for access tokens + refresh token pattern

#### 3. **No Refresh Token Implementation**
**Risk:** Long-lived access tokens without rotation mechanism
**Recommendation:** Implement refresh token pattern with separate rotation

#### 4. **No Rate Limiting on Auth Endpoints**
**Files:** `register`, `login` routes
**Risk:** Brute force password attacks, spam registration
**Recommendation:** Add rate limiting (e.g., 5 attempts per 15 min)

#### 5. **Plaintext Airtable Error Logging**
**File:** [src/app/api/tasks/[id]/route.ts](src/app/api/tasks/[id]/route.ts)
```typescript
catch (error) {
  console.error("Airtable sync error:", error);  // May expose API keys
}
```
**Risk:** Error logs may contain sensitive data
**Fix:** Log only error message, not full error object

---

### 🟠 **HIGH PRIORITY ISSUES**

#### 6. **No Input Sanitization on String Fields**
**Files:** All schema files
**Issue:** Accept and store raw strings without HTML/script sanitization
**Risk:** XSS if rendered without escaping
**Recommendation:** Sanitize inputs (e.g., DOMPurify for web content)

#### 7. **N+1 Database Queries**
**File:** [src/app/api/projects/route.ts](src/app/api/projects/route.ts)
```typescript
memberships.map((m) => ({...}))  // Separate query per membership
```
**Issue:** Already using `include` but could still happen in other endpoints
**Fix:** Review all Prisma queries for unnecessary nested queries

#### 8. **No Authorization Check in PATCH /tasks/[id]**
**File:** [src/app/api/tasks/[id]/route.ts](src/app/api/tasks/[id]/route.ts)
```typescript
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  // Missing: verify user is member of the task's project!
  const task = await prisma.task.update({ where: { id } });
}
```
**Risk:** User can modify ANY task in the database
**Fix:** Add membership check before update

#### 9. **No Authorization Check in DELETE /tasks/[id]**
**File:** [src/app/api/tasks/[id]/route.ts](src/app/api/tasks/[id]/route.ts)
**Risk:** Same as above - missing project membership verification
**Note:** Delete has check but PATCH doesn't!

#### 10. **Hardcoded Password Hash Rounds**
**File:** [src/app/api/auth/register/route.ts](src/app/api/auth/register/route.ts)
```typescript
const passwordHash = await bcrypt.hash(password, 10);  // Hardcoded
```
**Issue:** Should be configurable via environment
**Recommendation:** Move to `.env` config

#### 11. **No Airtable API Error Handling**
**File:** [src/lib/airtable.ts](src/lib/airtable.ts)
```typescript
const base = new Airtable({
  apiKey: process.env.AIRTABLE_API_KEY,
}).base(process.env.AIRTABLE_BASE_ID!);
```
**Risk:** If env vars missing, silent failures
**Recommendation:** Validate env vars on startup, throw early

#### 12. **localStorage for Sensitive Data**
**File:** [src/lib/api-client.ts](src/lib/api-client.ts)
```typescript
window.localStorage.setItem(TOKEN_KEY, token);  // XSS vulnerable!
```
**Risk:** JWT tokens in localStorage are exposed to XSS
**Recommendation:** Use HttpOnly cookies (server-set) instead

---

### 🟡 **MEDIUM PRIORITY ISSUES**

#### 13. **No CORS Configuration**
**Issue:** No explicit CORS setup in Next.js
**Risk:** May allow unauthorized cross-origin requests
**Recommendation:** Add CORS middleware/configuration

#### 14. **No Request Validation Middleware**
**Issue:** Content-Type validation missing
**Recommendation:** Validate request is JSON before parsing

#### 15. **No Pagination on List Endpoints**
**Files:** `/api/projects`, `/api/projects/[id]/tasks`
**Risk:** Full dataset returned; database overload with large datasets
**Recommendation:** Add limit/offset pagination

#### 16. **Inconsistent Error Responses**
**Issue:** Some endpoints return `{ error: string }`, others `{ error, details }`
**Recommendation:** Standardize error response format

#### 17. **Missing Cascade Delete Behavior**
**File:** [prisma/schema.prisma](prisma/schema.prisma)
```typescript
user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
```
**Issue:** Deleting user deletes all memberships (ok), but what about tasks?
**Risk:** Data integrity - orphaned tasks if project deleted
**Recommendation:** Review cascade behavior for tasks

#### 18. **No Soft Deletes**
**Issue:** Tasks are hard-deleted, no audit trail
**Recommendation:** Add `deletedAt` timestamp for soft deletes

#### 19. **No Logging/Audit Trail**
**Issue:** No audit log of who changed what and when
**Recommendation:** Add audit trail for compliance

#### 20. **No Input Length Validation Inconsistency**
**Files:** Schemas
**Issue:** Task title/description have no max length validation
**Risk:** Database field overflow
**Recommendation:** Add max lengths to all string fields

---

### 🔵 **LOW PRIORITY ISSUES**

#### 21. **Hardcoded Status Mapping**
**File:** [src/app/api/tasks/[id]/route.ts](src/app/api/tasks/[id]/route.ts)
```typescript
const statusMap: Record<string, string> = {...}  // Duplicated
```
**Issue:** Duplicated in both create and update endpoints
**Recommendation:** Extract to shared utility

#### 22. **No Database Connection Pool Monitoring**
**Issue:** Prisma connection pool not monitored
**Recommendation:** Add metrics/monitoring for connection health

#### 23. **No Request Timeout Configuration**
**Issue:** Long-running queries not bounded
**Recommendation:** Add request timeout limits

#### 24. **No Environment Validation on Startup**
**Issue:** Missing env vars cause runtime errors
**Recommendation:** Validate all required env vars on server start

#### 25. **Unused Imports/Dead Code**
**Issue:** Check for unused dependencies (airtable-mock)
**Recommendation:** Code cleanup

---

## 5. SECURITY SUMMARY

| Category | Status | Priority |
|----------|--------|----------|
| **Authentication** | ✅ Basic JWT implemented | — |
| **Authorization** | 🔴 Missing checks on tasks PATCH | CRITICAL |
| **SQL Injection** | 🔴 Raw queries on search endpoint | CRITICAL |
| **Token Expiration** | 🟠 30 days too long | HIGH |
| **Password Hashing** | ✅ bcryptjs 10 rounds | GOOD |
| **Session Management** | 🟠 No refresh tokens | HIGH |
| **Input Validation** | 🟡 Basic Zod schemas | MEDIUM |
| **Input Sanitization** | 🔴 No HTML escaping | HIGH |
| **HTTPS/TLS** | ❓ Not configured | MEDIUM |
| **Rate Limiting** | 🔴 Missing | HIGH |
| **CORS** | ❓ Not configured | MEDIUM |
| **Logging** | 🟡 Basic, no audit trail | MEDIUM |
| **Error Handling** | 🟡 Inconsistent | LOW |

---

## 6. PERFORMANCE CONCERNS

| Issue | Impact | Fix |
|-------|--------|-----|
| No pagination | Database overload | Add limit/offset |
| N+1 queries in projcets GET | Slow response | Optimize includes |
| Full task data in project GET | Excessive data | Return only IDs + basic info |
| SQL raw query for search | Database CPU spike | Use ORM with proper indexes |
| No database indexes on search fields | Slow queries | Add indexes on title, description |
| No caching | Repeated database hits | Add Redis/in-memory cache |

---

## 7. ARCHITECTURE ISSUES

| Issue | Impact | Recommendation |
|-------|--------|-----------------|
| Mixed concerns in API routes | Hard to test/maintain | Extract services layer |
| No error boundary | Silent failures | Add centralized error handling |
| Airtable tightly coupled | Hard to remove integration | Create adapter pattern |
| No API versioning | Breaking changes | Consider v1/v2 routes |
| Frontend stores JWT in localStorage | XSS vulnerable | Use HttpOnly cookies |
| No request logging middleware | Hard to debug | Add request/response logger |

---

## 8. DATA INTEGRITY CONCERNS

| Issue | Risk | Fix |
|-------|------|-----|
| No transaction support | Partial updates possible | Use Prisma transactions |
| Hard deletes only | No audit trail | Implement soft deletes |
| No unique constraint on email | Duplicate emails possible | Add unique index (likely already in DB) |
| airtableId optional without validation | Sync inconsistencies | Validate sync state |
| No position/ordering validation | Tasks order corrupted | Add position normalization |

---

## 9. TESTING GAPS

| Area | Coverage | Recommendation |
|------|----------|-----------------|
| Authentication | ✅ auth.test.ts exists | Verify all edge cases |
| Authorization | 🔴 Missing | Test RBAC enforcement |
| SQL Injection | 🔴 Missing | Add security tests |
| Input validation | ✅ schemas.test.ts exists | Expand edge cases |
| Components | ✅ TaskCard.test.tsx | Add E2E tests |
| API endpoints | 🔴 Missing | Add integration tests |
| Database | 🔴 Missing | Add seed/rollback tests |

---

## 10. RECOMMENDED ACTION ITEMS (Priority Order)

### 🔴 MUST FIX (Before Production)
- [ ] Fix SQL injection in task search endpoint
- [ ] Add authorization check to PATCH /tasks/[id]
- [ ] Reduce JWT token expiration to 15 minutes
- [ ] Implement refresh token pattern
- [ ] Add rate limiting to auth endpoints
- [ ] Move JWT tokens to HttpOnly cookies
- [ ] Add input sanitization for XSS prevention

### 🟠 SHOULD FIX (Sprint 1)
- [ ] Add database indexes for search fields
- [ ] Implement pagination on list endpoints
- [ ] Add audit logging for all mutations
- [ ] Extract services layer from API routes
- [ ] Add comprehensive API error handling
- [ ] Validate environment variables on startup
- [ ] Add request timeout limits

### 🟡 NICE TO HAVE (Sprint 2)
- [ ] Add CORS configuration
- [ ] Implement caching layer
- [ ] Add API rate limiting globally
- [ ] Setup request/response logging middleware
- [ ] Add API versioning
- [ ] Implement soft deletes
- [ ] Add database connection pool monitoring

---

## 11. ENVIRONMENT CHECKLIST

**Required .env variables:**
```
DATABASE_URL=postgresql://...
JWT_SECRET=<strong-secret>
AIRTABLE_API_KEY=<key>
AIRTABLE_BASE_ID=<id>
AIRTABLE_TABLE_NAME=<name>
```

**Recommended additions:**
```
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
BCRYPT_ROUNDS=10
NODE_ENV=development|production
LOG_LEVEL=debug|info|warn|error
```

---

## 12. NEXT STEPS

1. **Security Audit:** Address all 🔴 CRITICAL issues immediately
2. **Code Review:** Add mandatory security review checklist
3. **Testing:** Expand test coverage for auth & authorization
4. **Monitoring:** Add application performance monitoring (APM)
5. **Documentation:** Create API security documentation
6. **Training:** Team security awareness workshop
