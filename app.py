import os
from datetime import datetime
from functools import wraps

from flask import (
    Flask, render_template, request, redirect, url_for, flash, abort
)
from flask_sqlalchemy import SQLAlchemy
from flask_login import (
    LoginManager, UserMixin, login_user, logout_user,
    login_required, current_user
)
from werkzeug.security import generate_password_hash, check_password_hash

# ── App Config ──────────────────────────────────────────────
app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key-change-me')
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'sqlite:///jalorysil.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

login_manager = LoginManager(app)
login_manager.login_view = 'login'
login_manager.login_message = '로그인이 필요합니다.'
login_manager.login_message_category = 'warning'

CATEGORY_CHOICES = {
    'investment': '투자정보',
    'realestate': '부동산정보',
    'news': '조합소식',
}

# ── Models ──────────────────────────────────────────────────

class User(UserMixin, db.Model):
    __tablename__ = 'user'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    is_admin = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Article(db.Model):
    __tablename__ = 'article'
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    content = db.Column(db.Text, nullable=False)
    category = db.Column(db.String(20), nullable=False)
    author_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    views = db.Column(db.Integer, default=0)

    author = db.relationship('User', backref=db.backref('articles', lazy=True))


# ── Login Manager ───────────────────────────────────────────

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))


# ── Decorators ──────────────────────────────────────────────

def admin_required(f):
    @wraps(f)
    @login_required
    def decorated(*args, **kwargs):
        if not current_user.is_admin:
            abort(403)
        return f(*args, **kwargs)
    return decorated


# ── Auth Routes ─────────────────────────────────────────────

@app.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    if request.method == 'POST':
        username = request.form['username'].strip()
        password = request.form['password']
        name = request.form['name'].strip()
        email = request.form['email'].strip()

        if not all([username, password, name, email]):
            flash('모든 항목을 입력해주세요.', 'danger')
            return redirect(url_for('register'))
        if len(password) < 4:
            flash('비밀번호는 4자 이상이어야 합니다.', 'danger')
            return redirect(url_for('register'))
        if User.query.filter_by(username=username).first():
            flash('이미 사용중인 아이디입니다.', 'danger')
            return redirect(url_for('register'))
        if User.query.filter_by(email=email).first():
            flash('이미 등록된 이메일입니다.', 'danger')
            return redirect(url_for('register'))

        user = User(username=username, name=name, email=email)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        flash('회원가입이 완료되었습니다. 로그인해주세요.', 'success')
        return redirect(url_for('login'))
    return render_template('register.html')


@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    if request.method == 'POST':
        username = request.form['username'].strip()
        password = request.form['password']
        user = User.query.filter_by(username=username).first()

        if user and user.check_password(password):
            login_user(user)
            next_page = request.args.get('next')
            if next_page and next_page.startswith('/'):
                return redirect(next_page)
            return redirect(url_for('index'))
        flash('아이디 또는 비밀번호가 올바르지 않습니다.', 'danger')
    return render_template('login.html')


@app.route('/logout')
@login_required
def logout():
    logout_user()
    flash('로그아웃되었습니다.', 'info')
    return redirect(url_for('index'))


# ── Main Routes ─────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html', categories=CATEGORY_CHOICES)


@app.route('/jalorysil/<category>')
def article_list(category):
    if category not in CATEGORY_CHOICES:
        abort(404)
    articles = Article.query.filter_by(category=category) \
                     .order_by(Article.created_at.desc()).all()
    return render_template(
        'article_list.html',
        articles=articles,
        category=category,
        category_name=CATEGORY_CHOICES[category],
    )


@app.route('/jalorysil/<category>/<int:article_id>')
@login_required
def article_detail(category, article_id):
    article = Article.query.get_or_404(article_id)
    if article.category != category:
        abort(404)
    article.views += 1
    db.session.commit()
    return render_template('article_detail.html', article=article, category=category)


# ── Admin Routes ────────────────────────────────────────────

@app.route('/admin/article/new', methods=['GET', 'POST'])
@admin_required
def article_create():
    if request.method == 'POST':
        title = request.form['title'].strip()
        content = request.form['content'].strip()
        category = request.form['category']
        if not all([title, content]) or category not in CATEGORY_CHOICES:
            flash('모든 항목을 올바르게 입력해주세요.', 'danger')
            return redirect(url_for('article_create'))
        article = Article(
            title=title,
            content=content,
            category=category,
            author_id=current_user.id,
        )
        db.session.add(article)
        db.session.commit()
        flash('게시글이 등록되었습니다.', 'success')
        return redirect(url_for('article_list', category=category))
    return render_template('article_form.html', categories=CATEGORY_CHOICES)


@app.route('/admin/article/<int:article_id>/edit', methods=['GET', 'POST'])
@admin_required
def article_edit(article_id):
    article = Article.query.get_or_404(article_id)
    if request.method == 'POST':
        article.title = request.form['title'].strip()
        article.content = request.form['content'].strip()
        article.category = request.form['category']
        if not all([article.title, article.content]) or article.category not in CATEGORY_CHOICES:
            flash('모든 항목을 올바르게 입력해주세요.', 'danger')
            return redirect(url_for('article_edit', article_id=article.id))
        db.session.commit()
        flash('게시글이 수정되었습니다.', 'success')
        return redirect(url_for('article_detail', category=article.category, article_id=article.id))
    return render_template('article_form.html', article=article, categories=CATEGORY_CHOICES)


@app.route('/admin/article/<int:article_id>/delete', methods=['POST'])
@admin_required
def article_delete(article_id):
    article = Article.query.get_or_404(article_id)
    category = article.category
    db.session.delete(article)
    db.session.commit()
    flash('게시글이 삭제되었습니다.', 'success')
    return redirect(url_for('article_list', category=category))


# ── Run ─────────────────────────────────────────────────────

with app.app_context():
    db.create_all()
    # 관리자 계정 자동 생성
    if not User.query.filter_by(username='admin').first():
        admin = User(username='admin', name='관리자', email='admin@example.com', is_admin=True)
        admin.set_password(os.environ.get('ADMIN_PASSWORD', 'admin123'))
        db.session.add(admin)
        db.session.commit()

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
