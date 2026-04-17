package com.tutien.pixel.entities.dtos;

import com.tutien.pixel.entities.canhGioiEntity;
import com.tutien.pixel.entities.enums.linhCanEnum;
import com.tutien.pixel.entities.skillEntity;
import com.tutien.pixel.entities.statsEmbed;
import com.tutien.pixel.entities.trangBiEmbed;
import jakarta.persistence.Column;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;

import java.util.List;

public class PlayerDto {
    private int id;
    private int userId;
    private statsEmbed stats;

    private String name;
    @Enumerated(EnumType.STRING)
    private linhCanEnum linhCan;
    private String tenCanhGioi;
    private int tangTuVi;
    private String maCanhGioi;
    private int hp;
    private int maxHp;
    private int mp;
    private int maxMp;
    private int xu;
    private int tuViHienTai;
    private int tuViLenCap;
    private int x; //spawn tại x
    private int y; // spawn tai y
    private int px;
    private int py;
    private String mapCode;
    private trangBiEmbed trangBi;
    private int iventoryIndex;
    private int attackCD;
    private double heal_hp;
    private double heal_mp;
    private String jsonIventory;
    private String crit;
    private int speed;
    private String equip_slot;
    private List<skillEntity> skills;
    private canhGioiEntity canhGioi;
    private int tuViLinhCan;

    public PlayerDto(int id, int userId, statsEmbed stats, String name, linhCanEnum linhCan, String tenCanhGioi, int tangTuVi, String maCanhGioi, int hp, int maxHp, int mp, int maxMp, int xu, int tuViHienTai, int tuViLenCap, int x, int y, int px, int py, String mapCode, trangBiEmbed trangBi, int iventoryIndex, int attackCD, double heal_hp, double heal_mp, String jsonIventory, String crit, int speed, String equip_slot, List<skillEntity> skills, canhGioiEntity canhGioi, int tuViLinhCan) {
        this.id = id;
        this.userId = userId;
        this.stats = stats;
        this.name = name;
        this.linhCan = linhCan;
        this.tenCanhGioi = tenCanhGioi;
        this.tangTuVi = tangTuVi;
        this.maCanhGioi = maCanhGioi;
        this.hp = hp;
        this.maxHp = maxHp;
        this.mp = mp;
        this.maxMp = maxMp;
        this.xu = xu;
        this.tuViHienTai = tuViHienTai;
        this.tuViLenCap = tuViLenCap;
        this.x = x;
        this.y = y;
        this.px = px;
        this.py = py;
        this.mapCode = mapCode;
        this.trangBi = trangBi;
        this.iventoryIndex = iventoryIndex;
        this.attackCD = attackCD;
        this.heal_hp = heal_hp;
        this.heal_mp = heal_mp;
        this.jsonIventory = jsonIventory;
        this.crit = crit;
        this.speed = speed;
        this.equip_slot = equip_slot;
        this.skills = skills;
        this.canhGioi = canhGioi;
        this.tuViLinhCan = tuViLinhCan;
    }

    public String getEquip_slot() {
        return equip_slot;
    }

    public void setEquip_slot(String equip_slot) {
        this.equip_slot = equip_slot;
    }

    public int getTuViLinhCan() {
        return tuViLinhCan;
    }

    public void setTuViLinhCan(int tuViLinhCan) {
        this.tuViLinhCan = tuViLinhCan;
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

    public linhCanEnum getLinhCan() {
        return linhCan;
    }

    public void setLinhCan(linhCanEnum linhCan) {
        this.linhCan = linhCan;
    }

    public String getTenCanhGioi() {
        return tenCanhGioi;
    }

    public void setTenCanhGioi(String tenCanhGioi) {
        this.tenCanhGioi = tenCanhGioi;
    }

    public int getTangTuVi() {
        return tangTuVi;
    }

    public void setTangTuVi(int tangTuVi) {
        this.tangTuVi = tangTuVi;
    }

    public String getMaCanhGioi() {
        return maCanhGioi;
    }

    public void setMaCanhGioi(String maCanhGioi) {
        this.maCanhGioi = maCanhGioi;
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

    public int getTuViHienTai() {
        return tuViHienTai;
    }

    public void setTuViHienTai(int tuViHienTai) {
        this.tuViHienTai = tuViHienTai;
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

    public String getMapCode() {
        return mapCode;
    }

    public void setMapCode(String mapCode) {
        this.mapCode = mapCode;
    }

    public trangBiEmbed getTrangBi() {
        return trangBi;
    }

    public void setTrangBi(trangBiEmbed trangBi) {
        this.trangBi = trangBi;
    }

    public int getIventoryIndex() {
        return iventoryIndex;
    }

    public void setIventoryIndex(int iventoryIndex) {
        this.iventoryIndex = iventoryIndex;
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

    public String getJsonIventory() {
        return jsonIventory;
    }

    public void setJsonIventory(String jsonIventory) {
        this.jsonIventory = jsonIventory;
    }

    public String getCrit() {
        return crit;
    }

    public void setCrit(String crit) {
        this.crit = crit;
    }

    public int getSpeed() {
        return speed;
    }

    public void setSpeed(int speed) {
        this.speed = speed;
    }

    public List<skillEntity> getSkills() {
        return skills;
    }

    public void setSkills(List<skillEntity> skills) {
        this.skills = skills;
    }

    public canhGioiEntity getCanhGioi() {
        return canhGioi;
    }

    public void setCanhGioi(canhGioiEntity canhGioi) {
        this.canhGioi = canhGioi;
    }
}
