import { Router } from 'express';
import { mobileAuthController } from '../controllers/mobileAuth.controller';
import { mobileFeedController } from '../controllers/mobileFeed.controller';
import { mobilePostController } from '../controllers/mobilePost.controller';
import { mobileReelController } from '../controllers/mobileReel.controller';
import { mobileSocialController } from '../controllers/mobileSocial.controller';
import { mobileUserController } from '../controllers/mobileUser.controller';
import { mobileReportController } from '../controllers/mobileReport.controller';
import { mobileNotificationController } from '../controllers/mobileNotification.controller';
import { mobileCategoryController } from '../controllers/mobileCategory.controller';
import { authenticateUser, optionalUserAuth } from '../middleware/userAuth.middleware';

export const mobileRouter = Router();

// Authentication
mobileRouter.post('/auth/signup', (req, res, next) => mobileAuthController.signUp(req, res, next));
mobileRouter.post('/auth/login', (req, res, next) => mobileAuthController.login(req, res, next));
mobileRouter.post('/auth/forgot-password', (req, res, next) => mobileAuthController.forgotPassword(req, res, next));
mobileRouter.post('/auth/otp/send', (req, res, next) => mobileAuthController.sendOtp(req, res, next));
mobileRouter.post('/auth/otp/verify', (req, res, next) => mobileAuthController.verifyOtp(req, res, next));
mobileRouter.post('/auth/google', (req, res, next) => mobileAuthController.googleLogin(req, res, next));
mobileRouter.get('/auth/me', authenticateUser, (req, res, next) => mobileAuthController.getMe(req, res, next));


// Categories
mobileRouter.get('/categories', (req, res, next) => mobileCategoryController.getCategories(req, res, next));

// Home Feed
mobileRouter.get('/feed', optionalUserAuth, (req, res, next) => mobileFeedController.getFeed(req, res, next));
mobileRouter.get('/feed/following', authenticateUser, (req, res, next) => mobileFeedController.getFollowingFeed(req, res, next));

// Posts (Create, Delete)
mobileRouter.post('/posts', authenticateUser, (req, res, next) => mobilePostController.createPost(req, res, next));
mobileRouter.delete('/posts/:postId', authenticateUser, (req, res, next) => mobilePostController.deletePost(req, res, next));

// Reels (Feed, Create, Views)
mobileRouter.get('/reels/foryou', optionalUserAuth, (req, res, next) => mobileReelController.getForYouReels(req, res, next));
mobileRouter.get('/reels/following', authenticateUser, (req, res, next) => mobileReelController.getFollowingReels(req, res, next));
mobileRouter.post('/reels', authenticateUser, (req, res, next) => mobileReelController.createReel(req, res, next));
mobileRouter.post('/reels/:reelId/view', optionalUserAuth, (req, res, next) => mobileReelController.recordReelView(req, res, next));

// Comments
mobileRouter.get('/comments', optionalUserAuth, (req, res, next) => mobileSocialController.getComments(req, res, next));
mobileRouter.post('/comments', authenticateUser, (req, res, next) => mobileSocialController.addComment(req, res, next));
mobileRouter.delete('/comments/:commentId', authenticateUser, (req, res, next) => mobileSocialController.deleteComment(req, res, next));

// Likes, Saves, Follows
mobileRouter.post('/likes/post/:postId', authenticateUser, (req, res, next) => mobileSocialController.toggleLikePost(req, res, next));
mobileRouter.post('/likes/reel/:reelId', authenticateUser, (req, res, next) => mobileSocialController.toggleLikeReel(req, res, next));
mobileRouter.post('/saves/post/:postId', authenticateUser, (req, res, next) => mobileSocialController.toggleSavePost(req, res, next));
mobileRouter.post('/saves/reel/:reelId', authenticateUser, (req, res, next) => mobileSocialController.toggleSaveReel(req, res, next));
mobileRouter.post('/users/:userId/follow', authenticateUser, (req, res, next) => mobileSocialController.toggleFollow(req, res, next));

// Profiles & Users
mobileRouter.get('/users/profile/:userId', optionalUserAuth, (req, res, next) => mobileUserController.getProfile(req, res, next));
mobileRouter.put('/users/profile', authenticateUser, (req, res, next) => mobileUserController.updateProfile(req, res, next));
mobileRouter.delete('/users/account', authenticateUser, (req, res, next) => mobileUserController.deleteAccount(req, res, next));
mobileRouter.get('/users/:userId/posts', optionalUserAuth, (req, res, next) => mobileUserController.getUserPosts(req, res, next));
mobileRouter.get('/users/:userId/reels', optionalUserAuth, (req, res, next) => mobileUserController.getUserReels(req, res, next));
mobileRouter.get('/users/:userId/followers', optionalUserAuth, (req, res, next) => mobileUserController.getUserFollowers(req, res, next));
mobileRouter.get('/users/:userId/following', optionalUserAuth, (req, res, next) => mobileUserController.getUserFollowing(req, res, next));

// Reports
mobileRouter.post('/reports', authenticateUser, (req, res, next) => mobileReportController.submitReport(req, res, next));

// Notifications
mobileRouter.get('/notifications', authenticateUser, (req, res, next) => mobileNotificationController.getNotifications(req, res, next));
mobileRouter.post('/notifications/:id/read', authenticateUser, (req, res, next) => mobileNotificationController.markAsRead(req, res, next));
