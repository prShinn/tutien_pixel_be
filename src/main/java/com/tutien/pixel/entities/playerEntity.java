package com.tutien.pixel.entities;

import com.tutien.pixel.entities.enums.linhCanEnum;
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
    private int iventoryIndex;
    private int attackCD;
    private double heal_hp;
    private double heal_mp;
    private int sttDaiCanhGioi;
    private int sttCanhGioi;
    private String jsonIventory;

    public String getJsonIventory() {
        return jsonIventory;
    }

    public void setJsonIventory(String jsonIventory) {
        this.jsonIventory = jsonIventory;
    }

    public int getSttDaiCanhGioi() {
        return sttDaiCanhGioi;
    }

    public void setSttDaiCanhGioi(int sttDaiCanhGioi) {
        this.sttDaiCanhGioi = sttDaiCanhGioi;
    }

    public int getSttCanhGioi() {
        return sttCanhGioi;
    }

    public void setSttCanhGioi(int sttCanhGioi) {
        this.sttCanhGioi = sttCanhGioi;
    }

    public int getAttackCD() {
        return attackCD;
    }

    public void setAttackCD(int attackCD) {
        this.attackCD = attackCD;
    }

    public double getHeal_hp() {
        return heal_hp;
    }

    public void setHeal_hp(double heal_hp) {
        this.heal_hp = heal_hp;
    }

    public double getHeal_mp() {
        return heal_mp;
    }

    public void setHeal_mp(double heal_mp) {
        this.heal_mp = heal_mp;
    }

    public int getIventoryIndex() {
        return iventoryIndex;
    }

    public void setIventoryIndex(int iventoryIndex) {
        this.iventoryIndex = iventoryIndex;
    }

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
