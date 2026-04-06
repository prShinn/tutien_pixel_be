package com.tutien.pixel.entities;

import jakarta.persistence.*;

@Entity
@Table(name = "players")
public class playerEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    private int userId;
    private statsEmbed stats;
    @Column(unique = true)
    private String name;
    @Enumerated(EnumType.STRING)
    private linhCanEnum root;
    private String canhGioi;
    private String daiCanhGioi;
    private int hp;
    private int maxHp;
    private int mp;
    private int maxMp;
    private int xu;
    private int tuVi;
    private int tuViLenCap;
    private int x; //spawn tại x
    private int y; // spawn tai y
    private int px;
    private int py;
    private trangBiEmbed trangBi;

    public int getId() {
        return id;
    }

    public void setId(int id) {
        this.id = id;
    }

    public int getUserId() {
        return userId;
    }

    public void setUserId(int userId) {
        this.userId = userId;
    }

    public statsEmbed getStats() {
        return stats;
    }

    public void setStats(statsEmbed stats) {
        this.stats = stats;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public linhCanEnum getRoot() {
        return root;
    }

    public void setRoot(linhCanEnum root) {
        this.root = root;
    }

    public String getCanhGioi() {
        return canhGioi;
    }

    public void setCanhGioi(String canhGioi) {
        this.canhGioi = canhGioi;
    }

    public String getDaiCanhGioi() {
        return daiCanhGioi;
    }

    public void setDaiCanhGioi(String daiCanhGioi) {
        this.daiCanhGioi = daiCanhGioi;
    }

    public int getHp() {
        return hp;
    }

    public void setHp(int hp) {
        this.hp = hp;
    }

    public int getMaxHp() {
        return maxHp;
    }

    public void setMaxHp(int maxHp) {
        this.maxHp = maxHp;
    }

    public int getMp() {
        return mp;
    }

    public void setMp(int mp) {
        this.mp = mp;
    }

    public int getMaxMp() {
        return maxMp;
    }

    public void setMaxMp(int maxMp) {
        this.maxMp = maxMp;
    }

    public int getXu() {
        return xu;
    }

    public void setXu(int xu) {
        this.xu = xu;
    }

    public int getTuVi() {
        return tuVi;
    }

    public void setTuVi(int tuVi) {
        this.tuVi = tuVi;
    }

    public int getTuViLenCap() {
        return tuViLenCap;
    }

    public void setTuViLenCap(int tuViLenCap) {
        this.tuViLenCap = tuViLenCap;
    }

    public int getX() {
        return x;
    }

    public void setX(int x) {
        this.x = x;
    }

    public int getY() {
        return y;
    }

    public void setY(int y) {
        this.y = y;
    }

    public int getPx() {
        return px;
    }

    public void setPx(int px) {
        this.px = px;
    }

    public int getPy() {
        return py;
    }

    public void setPy(int py) {
        this.py = py;
    }

    public trangBiEmbed getTrangBi() {
        return trangBi;
    }

    public void setTrangBi(trangBiEmbed trangBi) {
        this.trangBi = trangBi;
    }
}
