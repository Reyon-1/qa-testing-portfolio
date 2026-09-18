-- ============================================
-- 企业内部综合管理系统数据验证 SQL 脚本
-- 数据库：ry_vue
-- 说明：用于验证功能操作后的数据一致性
-- ============================================

-- 1. 查询用户列表（验证新增/修改/删除后的数据）
SELECT user_id, user_name, nick_name, phonenumber, email, status, dept_id, create_time
FROM sys_user
WHERE del_flag = '0'
ORDER BY user_id;

-- 2. 查询用户总数
SELECT COUNT(*) AS user_total
FROM sys_user
WHERE del_flag = '0';

-- 3. 根据用户名搜索用户
SELECT user_id, user_name, nick_name, status
FROM sys_user
WHERE del_flag = '0' AND user_name LIKE '%admin%';

-- 4. 查询角色列表
SELECT role_id, role_name, role_key, role_sort, status, create_time
FROM sys_role
WHERE del_flag = '0'
ORDER BY role_sort;

-- 5. 查询角色对应的菜单权限（多表关联）
SELECT r.role_id, r.role_name, m.menu_id, m.menu_name, m.perms
FROM sys_role r
LEFT JOIN sys_role_menu rm ON r.role_id = rm.role_id
LEFT JOIN sys_menu m ON rm.menu_id = m.menu_id
WHERE r.del_flag = '0' AND r.role_id = 1
ORDER BY m.order_num;

-- 6. 查询菜单树结构
SELECT menu_id, menu_name, parent_id, order_num, path, component, menu_type, status
FROM sys_menu
WHERE visible = '0'
ORDER BY parent_id, order_num;

-- 7. 查询部门列表
SELECT dept_id, dept_name, parent_id, leader, phone, status, order_num
FROM sys_dept
WHERE del_flag = '0'
ORDER BY order_num;

-- 8. 查询字典类型列表
SELECT dict_id, dict_name, dict_type, status, create_time
FROM sys_dict_type
WHERE del_flag = '0'
ORDER BY dict_id;

-- 9. 查询操作日志（最近10条）
SELECT oper_id, title, business_type, oper_name, oper_ip, oper_time, status
FROM sys_oper_log
ORDER BY oper_time DESC
LIMIT 10;

-- 10. 查询登录日志（最近10条）
SELECT info_id, user_name, ipaddr, login_location, status, msg, login_time
FROM sys_logininfor
ORDER BY login_time DESC
LIMIT 10;

-- 11. 统计各模块操作次数（聚合查询）
SELECT title AS module, COUNT(*) AS oper_count
FROM sys_oper_log
GROUP BY title
ORDER BY oper_count DESC;

-- 12. 查询某个用户的角色信息
SELECT u.user_id, u.user_name, u.nick_name, r.role_id, r.role_name, r.role_key
FROM sys_user u
LEFT JOIN sys_user_role ur ON u.user_id = ur.user_id
LEFT JOIN sys_role r ON ur.role_id = r.role_id
WHERE u.del_flag = '0' AND u.user_name = 'admin';
